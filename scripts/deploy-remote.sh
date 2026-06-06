#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="mangatsu"
SERVICE_NAME="mangatsu"
INSTALL_DIR="/var/www/mangatsu"
SERVICE_USER="www-data"
SERVICE_GROUP="www-data"
PORT="3000"
PROXY_MODE="auto"
DOMAIN=""
CADDY_EMAIL=""
SSH_PORT="22"
DRY_RUN=false
SKIP_BUILD=false
SSH_TARGET=""
SSH_LOGIN_USER=""
SSH_CONTROL_PATH="${TMPDIR:-/tmp}/mangatsu-ssh-%C"
REMOTE_STAGE_DIR="/tmp/${SERVICE_NAME}-deploy"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

log() {
	printf '[deploy] %s\n' "$*"
}

warn() {
	printf '[deploy] warning: %s\n' "$*" >&2
}

die() {
	printf '[deploy] error: %s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Usage:
  scripts/deploy-remote.sh --host user@server [options]

Options:
  --host <user@host>       SSH target for the remote server
  --port <port>            App port on the remote host (default: 3000)
  --install-dir <path>     Remote install path (default: /var/www/mangatsu)
  --service-user <user>    Systemd service user (default: www-data)
  --service-group <group>  Systemd service group (default: www-data)
  --proxy auto|caddy|nginx|none  Reverse proxy mode (default: auto)
  --domain <hostname>      Reverse proxy hostname (required for caddy/nginx)
  --caddy-email <email>    Caddy ACME contact email
  --ssh-port <port>        SSH port (default: 22)
  --skip-build             Skip the local build step
  --dry-run                Print actions without executing them
  -h, --help               Show this help

Environment overrides:
  MANGATSU_SSH_TARGET, MANGATSU_PORT, MANGATSU_INSTALL_DIR,
  MANGATSU_SERVICE_USER, MANGATSU_SERVICE_GROUP, MANGATSU_PROXY,
  MANGATSU_DOMAIN, MANGATSU_CADDY_EMAIL, MANGATSU_SSH_PORT,
  MANGATSU_DRY_RUN, MANGATSU_SKIP_BUILD
EOF
}

is_true() {
	case "${1,,}" in
		1|true|yes|on) return 0 ;;
		*) return 1 ;;
	esac
}

run_local() {
	if [[ "$DRY_RUN" == true ]]; then
		printf '[dry-run] '
		printf '%q ' "$@"
		printf '\n'
		return 0
	fi
	"$@"
}

open_ssh_master() {
	if [[ "$DRY_RUN" == true ]]; then
		printf '[dry-run] ssh -MNf -p %s %s\n' "$SSH_PORT" "$SSH_TARGET"
		return 0
	fi
	ssh -MNf -p "$SSH_PORT" \
		-o "ControlMaster=auto" \
		-o "ControlPersist=10m" \
		-o "ControlPath=${SSH_CONTROL_PATH}" \
		"$SSH_TARGET"
}

run_remote() {
	local script="$1"
	shift || true
	local remote_args
	printf -v remote_args '%q %q %q %q %q %q %q %q' \
		"$INSTALL_DIR" "$SERVICE_NAME" "$SERVICE_USER" "$SERVICE_GROUP" "$PORT" "$PROXY_MODE" "$DOMAIN" "$CADDY_EMAIL"
	if [[ "$DRY_RUN" == true ]]; then
		printf '[dry-run] ssh -tt -p %s -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=%q %s bash -s -- %s\n' \
			"$SSH_PORT" "$SSH_CONTROL_PATH" "$SSH_TARGET" "$remote_args"
		printf '%s\n' "$script"
		return 0
	fi
	ssh -tt -p "$SSH_PORT" \
		-o "ControlMaster=auto" \
		-o "ControlPersist=10m" \
		-o "ControlPath=${SSH_CONTROL_PATH}" \
		"$SSH_TARGET" "bash -s -- $remote_args" <<<"$script"
}

build_app() {
	if [[ "$DRY_RUN" == true ]]; then
		log "dry-run: skipping local build"
		return
	fi
	if [[ "$SKIP_BUILD" == true ]]; then
		log "skipping local build"
		return
	fi

	log "installing local dependencies"
	(
		cd "$REPO_ROOT"
		npm ci
	)

	log "building local app"
	(
		cd "$REPO_ROOT"
		npm run build
	)
}

sync_app() {
	log "syncing repository to ${SSH_TARGET}:${REMOTE_STAGE_DIR}"
	run_local rsync -az --delete --no-owner --no-group -e "ssh -p ${SSH_PORT} -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=${SSH_CONTROL_PATH}" \
		--exclude='.git' \
		--exclude='.claude' \
		--exclude='node_modules' \
		--exclude='dist' \
		--exclude='coverage' \
		"${REPO_ROOT}/" "${SSH_TARGET}:${REMOTE_STAGE_DIR}/"

	if [[ -d "${REPO_ROOT}/dist" ]]; then
		log "syncing build artifacts"
		run_local rsync -az --delete --no-owner --no-group -e "ssh -p ${SSH_PORT} -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=${SSH_CONTROL_PATH}" \
			"${REPO_ROOT}/dist/" "${SSH_TARGET}:${REMOTE_STAGE_DIR}/dist/"
	fi
}

install_remote_service() {
	local remote_script
	remote_script="$(cat <<'EOF'
set -Eeuo pipefail

INSTALL_DIR="$1"
STAGING_DIR="$2"
SERVICE_NAME="$3"
SERVICE_USER="$4"
SERVICE_GROUP="$5"
PORT="$6"
PROXY_MODE="$7"
DOMAIN="$8"
CADDY_EMAIL="$9"
DRY_RUN=false

log() {
	printf '[remote] %s\n' "$*"
}

warn() {
	printf '[remote] warning: %s\n' "$*" >&2
}

die() {
	printf '[remote] error: %s\n' "$*" >&2
	exit 1
}

sudo_run() {
	sudo -n "$@"
}

port_is_listening() {
	ss -H -ltn "sport = :${PORT}" | grep -q .
}

service_is_active() {
	sudo_run systemctl is-active --quiet "${SERVICE_NAME}.service"
}

wait_for_ready() {
	local attempt
	for attempt in $(seq 1 30); do
		if service_is_active && port_is_listening; then
			return 0
		fi
		sleep 1
	done

	warn "service did not become ready on port ${PORT}"
	sudo_run systemctl status "${SERVICE_NAME}.service" --no-pager -l || true
	sudo_run journalctl -u "${SERVICE_NAME}.service" --no-pager -n 100 || true
	die "service failed to bind to port ${PORT}"
}

choose_port() {
	local candidate="$PORT"
	while ss -H -ltn "sport = :${candidate}" | grep -q .; do
		candidate=$((candidate + 1))
		if (( candidate > 65535 )); then
			die "no free ports available starting from ${PORT}"
		fi
	done
	if [[ "$candidate" != "$PORT" ]]; then
		warn "port ${PORT} is in use; using ${candidate} instead"
	fi
	PORT="$candidate"
}

verify_build_artifacts() {
	if [[ "${DRY_RUN:-false}" == true ]]; then
		return
	fi
	if [[ ! -f "${INSTALL_DIR}/dist/index.html" ]]; then
		die "missing build artifact at ${INSTALL_DIR}/dist/index.html"
	fi
}

is_true() {
	case "${1,,}" in
		1|true|yes|on) return 0 ;;
		*) return 1 ;;
	esac
}

trim() {
	sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

managed_marker="# managed by mangatsu"
proxy_mode_resolved="$PROXY_MODE"

command -v python3 >/dev/null 2>&1 || die "python3 is required on the remote server"
command -v systemctl >/dev/null 2>&1 || die "systemctl is required on the remote server"
command -v ss >/dev/null 2>&1 || die "ss is required on the remote server"
command -v curl >/dev/null 2>&1 || die "curl is required on the remote server"
command -v rsync >/dev/null 2>&1 || die "rsync is required on the remote server"

log "refreshing sudo credentials"
sudo -v

if [[ "$proxy_mode_resolved" == "auto" ]]; then
	if command -v caddy >/dev/null 2>&1; then
		proxy_mode_resolved="caddy"
	elif command -v nginx >/dev/null 2>&1; then
		proxy_mode_resolved="nginx"
	else
		proxy_mode_resolved="none"
	fi
fi

if [[ "$proxy_mode_resolved" != "none" && -z "$DOMAIN" ]]; then
	die "a domain is required when reverse proxying"
fi

log "preparing remote install directory at ${INSTALL_DIR}"
sudo_run install -d -m 0755 "$INSTALL_DIR"
sudo_run rsync -a --delete "$STAGING_DIR"/ "$INSTALL_DIR"/
sudo_run chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "$INSTALL_DIR"

write_managed_file() {
	local target="$1"
	local content="$2"
	if [[ -f "$target" ]] && ! grep -qF "$managed_marker" "$target"; then
		die "${target} exists and is not managed by this script; refusing to overwrite"
	fi
	local tmp
	tmp="$(mktemp)"
	printf '%s\n' "$content" >"$tmp"
	sudo_run install -d -m 0755 "$(dirname "$target")"
	sudo_run install -m 0644 "$tmp" "$target"
	rm -f "$tmp"
}

install_service() {
	cat >/tmp/${SERVICE_NAME}.service <<SERVICEEOF
[Unit]
Description=${SERVICE_NAME} static web app
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/scripts/spa-http-server.py ${INSTALL_DIR}/dist --bind 127.0.0.1 --port ${PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF

	sudo_run install -m 0644 /tmp/${SERVICE_NAME}.service /etc/systemd/system/${SERVICE_NAME}.service
	rm -f /tmp/${SERVICE_NAME}.service
}

detect_caddy_snippet_dir() {
	local main_file="/etc/caddy/Caddyfile"
	local dir
	if [[ -n "${MANGATSU_CADDY_SNIPPET_DIR:-}" ]]; then
		printf '%s' "$MANGATSU_CADDY_SNIPPET_DIR"
		return 0
	fi
	if [[ -f "$main_file" ]]; then
		for dir in /etc/caddy/conf.d /etc/caddy/Caddyfile.d; do
			if grep -qE "^[[:space:]]*import[[:space:]].*${dir}/\\*\\.caddy" "$main_file" 2>/dev/null; then
				printf '%s' "$dir"
				return 0
			fi
		done
	fi
	for dir in /etc/caddy/conf.d /etc/caddy/Caddyfile.d; do
		if [[ -d "$dir" ]]; then
			printf '%s' "$dir"
			return 0
		fi
	done
	printf '%s' /etc/caddy/conf.d
}

configure_caddy() {
	local domain="$1"
	local port="$2"
	local main_file="/etc/caddy/Caddyfile"
	local snippet_dir snippet_file import_line content
	snippet_dir="$(detect_caddy_snippet_dir)"
	snippet_file="${snippet_dir}/${SERVICE_NAME}.caddy"
	import_line="import ${snippet_dir}/*.caddy"

	log "configuring caddy for ${domain}"
	sudo_run install -d -m 0755 "$snippet_dir"
	content="${managed_marker}
${domain} {
	${CADDY_EMAIL:+tls ${CADDY_EMAIL}}
	encode zstd gzip
	reverse_proxy localhost:${port}
}"
	write_managed_file "$snippet_file" "$content"

	if [[ ! -f "$main_file" ]]; then
		write_managed_file "$main_file" "${managed_marker}
${import_line}"
	else
		if grep -qE '^[[:space:]]*import[[:space:]].*(/etc/caddy/)?(conf\.d|Caddyfile\.d)/\*\.caddy' "$main_file"; then
			log "existing Caddyfile already imports a snippet directory; leaving it unchanged"
		else
			warn "existing Caddyfile does not import ${snippet_dir}; not modifying it"
			warn "add this line manually if needed: ${import_line}"
		fi
	fi

	if command -v caddy >/dev/null 2>&1; then
		sudo_run caddy validate --config "$main_file"
	fi
}

detect_nginx_style() {
	local nginx_main="/etc/nginx/nginx.conf"
	if [[ -n "${MANGATSU_NGINX_STYLE:-}" ]]; then
		printf '%s' "$MANGATSU_NGINX_STYLE"
		return 0
	fi
	if [[ -f "$nginx_main" ]] && grep -qE 'include[[:space:]]+.*/conf\.d/\*\.conf;' "$nginx_main"; then
		printf '%s' "conf.d"
		return 0
	fi
	if [[ -f "$nginx_main" ]] && grep -qE 'include[[:space:]]+.*/sites-enabled/\*;' "$nginx_main"; then
		printf '%s' "sites"
		return 0
	fi
	printf '%s' "unknown"
}

configure_nginx() {
	local domain="$1"
	local port="$2"
	local style
	local nginx_main="/etc/nginx/nginx.conf"
	style="$(detect_nginx_style)"

	log "configuring nginx for ${domain}"
	case "$style" in
		conf.d)
			local conf_file="/etc/nginx/conf.d/${SERVICE_NAME}.conf"
			local content
			content="${managed_marker}
server {
	listen 80;
	server_name ${domain};

	location / {
		proxy_pass http://127.0.0.1:${port};
		proxy_http_version 1.1;
		proxy_set_header Upgrade \$http_upgrade;
		proxy_set_header Connection \"upgrade\";
		proxy_set_header Host \$host;
		proxy_set_header X-Real-IP \$remote_addr;
		proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto \$scheme;
		proxy_read_timeout 3600;
		proxy_send_timeout 3600;
	}
}"
			write_managed_file "$conf_file" "$content"
			;;
		sites)
			local sites_available="/etc/nginx/sites-available/${SERVICE_NAME}.conf"
			local sites_enabled="/etc/nginx/sites-enabled/${SERVICE_NAME}.conf"
			local content
			content="${managed_marker}
server {
	listen 80;
	server_name ${domain};

	location / {
		proxy_pass http://127.0.0.1:${port};
		proxy_http_version 1.1;
		proxy_set_header Upgrade \$http_upgrade;
		proxy_set_header Connection \"upgrade\";
		proxy_set_header Host \$host;
		proxy_set_header X-Real-IP \$remote_addr;
		proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto \$scheme;
		proxy_read_timeout 3600;
		proxy_send_timeout 3600;
	}
}"
			write_managed_file "$sites_available" "$content"
			if [[ -e "$sites_enabled" && ! -L "$sites_enabled" ]]; then
				die "${sites_enabled} exists and is not a symlink; refusing to overwrite"
			fi
			if [[ -L "$sites_enabled" ]]; then
				local current_target
				current_target="$(readlink "$sites_enabled")"
				if [[ "$current_target" != "$sites_available" ]]; then
					die "${sites_enabled} points to ${current_target}; refusing to change it"
				fi
			else
				sudo_run ln -s "$sites_available" "$sites_enabled"
			fi
			;;
		unknown)
			warn "/etc/nginx/nginx.conf does not clearly enable conf.d or sites-enabled"
			warn "leaving nginx configuration unchanged"
			return 0
			;;
	esac

	sudo_run nginx -t
	sudo_run systemctl reload nginx 2>/dev/null || sudo_run systemctl restart nginx
}

configure_proxy() {
	case "$proxy_mode_resolved" in
		none)
			log "reverse proxy disabled"
			return 0
			;;
		caddy)
			command -v caddy >/dev/null 2>&1 || die "caddy is not installed on the remote server"
			configure_caddy "$DOMAIN" "$PORT"
			;;
		nginx)
			command -v nginx >/dev/null 2>&1 || die "nginx is not installed on the remote server"
			configure_nginx "$DOMAIN" "$PORT"
			;;
		*)
			die "unknown proxy mode: $proxy_mode_resolved"
			;;
	esac
}

log "normalizing ownership"
sudo_run chmod 0755 "$INSTALL_DIR"

log "stopping existing service"
sudo_run systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true

if port_is_listening; then
	choose_port
fi

verify_build_artifacts

log "writing systemd service"
install_service

log "reloading systemd"
sudo_run systemctl daemon-reload
sudo_run systemctl reset-failed "${SERVICE_NAME}.service" 2>/dev/null || true
sudo_run systemctl enable "${SERVICE_NAME}.service"
sudo_run systemctl start "${SERVICE_NAME}.service"

log "smoke testing"
wait_for_ready
curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/comic/test-deep-link" >/dev/null

configure_proxy

log "deployment complete"
EOF
)"
	local remote_script_file
	remote_script_file="$(mktemp)"
	printf '%s\n' "$remote_script" >"$remote_script_file"
	if [[ "$DRY_RUN" == true ]]; then
		local remote_args
		printf -v remote_args '%q %q %q %q %q %q %q %q %q' \
			"$INSTALL_DIR" "$REMOTE_STAGE_DIR" "$SERVICE_NAME" "$SERVICE_USER" "$SERVICE_GROUP" "$PORT" "$PROXY_MODE" "$DOMAIN" "$CADDY_EMAIL"
		printf '[dry-run] scp -P %s -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=%q %q %q:%q\n' \
			"$SSH_PORT" "$SSH_CONTROL_PATH" "$remote_script_file" "$SSH_TARGET" "/tmp/${SERVICE_NAME}-deploy.sh"
		printf '[dry-run] ssh -tt -p %s -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=%q %q bash %q %s\n' \
			"$SSH_PORT" "$SSH_CONTROL_PATH" "$SSH_TARGET" "/tmp/${SERVICE_NAME}-deploy.sh" "$remote_args"
		rm -f "$remote_script_file"
		return 0
	fi
	open_ssh_master
	scp -P "$SSH_PORT" \
		-o "ControlMaster=auto" \
		-o "ControlPersist=10m" \
		-o "ControlPath=${SSH_CONTROL_PATH}" \
		"$remote_script_file" "$SSH_TARGET:/tmp/${SERVICE_NAME}-deploy.sh"
	rm -f "$remote_script_file"
	ssh -tt -p "$SSH_PORT" \
		-o "ControlMaster=auto" \
		-o "ControlPersist=10m" \
		-o "ControlPath=${SSH_CONTROL_PATH}" \
		"$SSH_TARGET" "bash /tmp/${SERVICE_NAME}-deploy.sh $(printf '%q ' "$INSTALL_DIR" "$REMOTE_STAGE_DIR" "$SERVICE_NAME" "$SERVICE_USER" "$SERVICE_GROUP" "$PORT" "$PROXY_MODE" "$DOMAIN" "$CADDY_EMAIL")"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--host)
			SSH_TARGET="${2:-}"
			shift 2
			;;
		--port)
			PORT="${2:-}"
			shift 2
			;;
		--install-dir)
			INSTALL_DIR="${2:-}"
			shift 2
			;;
		--service-user)
			SERVICE_USER="${2:-}"
			shift 2
			;;
		--service-group)
			SERVICE_GROUP="${2:-}"
			shift 2
			;;
		--proxy)
			PROXY_MODE="${2:-}"
			shift 2
			;;
		--domain)
			DOMAIN="${2:-}"
			shift 2
			;;
		--caddy-email)
			CADDY_EMAIL="${2:-}"
			shift 2
			;;
		--ssh-port)
			SSH_PORT="${2:-}"
			shift 2
			;;
		--skip-build)
			SKIP_BUILD=true
			shift
			;;
		--dry-run)
			DRY_RUN=true
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			die "unknown argument: $1"
			;;
	esac
done

SSH_TARGET="${MANGATSU_SSH_TARGET:-$SSH_TARGET}"
PORT="${MANGATSU_PORT:-$PORT}"
INSTALL_DIR="${MANGATSU_INSTALL_DIR:-$INSTALL_DIR}"
SERVICE_USER="${MANGATSU_SERVICE_USER:-$SERVICE_USER}"
SERVICE_GROUP="${MANGATSU_SERVICE_GROUP:-$SERVICE_GROUP}"
PROXY_MODE="${MANGATSU_PROXY:-$PROXY_MODE}"
DOMAIN="${MANGATSU_DOMAIN:-$DOMAIN}"
CADDY_EMAIL="${MANGATSU_CADDY_EMAIL:-$CADDY_EMAIL}"
SSH_PORT="${MANGATSU_SSH_PORT:-$SSH_PORT}"

if is_true "${MANGATSU_DRY_RUN:-false}"; then
	DRY_RUN=true
fi
if is_true "${MANGATSU_SKIP_BUILD:-false}"; then
	SKIP_BUILD=true
fi

[[ -n "$SSH_TARGET" ]] || die "an SSH host is required; pass --host user@server or set MANGATSU_SSH_TARGET"
case "$PROXY_MODE" in
	auto|caddy|nginx|none) ;;
	*) die "invalid proxy mode: $PROXY_MODE" ;;
esac
if [[ "$PROXY_MODE" != "none" && -z "$DOMAIN" ]]; then
	die "a domain is required when proxy mode is ${PROXY_MODE}"
fi
if [[ "$PROXY_MODE" == "caddy" && -z "$CADDY_EMAIL" ]]; then
	warn "no Caddy email provided; Lets Encrypt contact email will be omitted"
fi
SSH_LOGIN_USER="${SSH_TARGET%@*}"

command -v rsync >/dev/null 2>&1 || die "rsync is required"
command -v ssh >/dev/null 2>&1 || die "ssh is required"
command -v scp >/dev/null 2>&1 || die "scp is required"
command -v npm >/dev/null 2>&1 || die "npm is required"

build_app
sync_app
install_remote_service

log "done"
