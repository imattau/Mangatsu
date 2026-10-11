package com.mangatsu.amberopener

import android.app.Activity
import android.content.Intent
import android.provider.Browser
import androidx.core.net.toUri
import android.net.Uri
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class OpenAmberUrlArgs {
    lateinit var url: String
}

@InvokeArg
class QuerySignerArgs {
    lateinit var type: String
    lateinit var payload: String
    var pubkey: String = ""
    lateinit var currentUser: String
    var signerPackage: String = DEFAULT_SIGNER_PACKAGE
}

const val DEFAULT_SIGNER_PACKAGE = "com.greenart7c3.nostrsigner"

/**
 * Amber (and other NIP-55 signer apps) only parse request parameters from a
 * nostrsigner: URL's own query string when the launching Intent carries the
 * Browser.EXTRA_APPLICATION_ID extra — that's the marker a real browser sets
 * when it resolves an intent:// link into an Intent. Without it, Amber
 * assumes it's a native-app request and looks for parameters as Intent
 * extras instead, finds none, and rejects it as malformed. Tauri's stock
 * opener plugin has no way to attach this extra, hence this plugin.
 */
@TauriPlugin
class AmberOpenerPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun openAmberUrl(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(OpenAmberUrlArgs::class.java)
            val intent = Intent(Intent.ACTION_VIEW, args.url.toUri())
            intent.putExtra(Browser.EXTRA_APPLICATION_ID, activity.packageName)
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.applicationContext.startActivity(intent)
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message)
        }
    }

    /**
     * NIP-55 background path: queries the signer's ContentResolver provider
     * (content://<package>.<TYPE>) instead of launching its UI. The signer
     * answers without opening only when the user chose "remember my choice"
     * for this app and request type; otherwise the cursor is null and the
     * caller falls back to the intent flow. Resolves {status, result} where
     * status is "ok", "unavailable" or "rejected".
     */
    @Command
    fun querySigner(invoke: Invoke) {
        val args = invoke.parseArgs(QuerySignerArgs::class.java)
        Thread {
            val out = JSObject()
            try {
                val uri = Uri.parse("content://${args.signerPackage}.${args.type}")
                val cursor = activity.contentResolver.query(
                    uri,
                    arrayOf(args.payload, args.pubkey, args.currentUser),
                    null,
                    null,
                    null,
                )
                if (cursor == null) {
                    out.put("status", "unavailable")
                } else {
                    cursor.use {
                        if (!it.moveToFirst()) {
                            out.put("status", "unavailable")
                        } else if (it.getColumnIndex("rejected") >= 0) {
                            out.put("status", "rejected")
                        } else {
                            var index = it.getColumnIndex("result")
                            if (index < 0) index = it.getColumnIndex("signature")
                            val value = if (index >= 0) it.getString(index) else null
                            if (value.isNullOrEmpty()) {
                                out.put("status", "unavailable")
                            } else {
                                out.put("status", "ok")
                                out.put("result", value)
                            }
                        }
                    }
                }
            } catch (ex: Exception) {
                // Provider missing, not exported, or not visible: use the intent flow.
                out.put("status", "unavailable")
            }
            invoke.resolve(out)
        }.start()
    }
}
