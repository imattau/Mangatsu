package com.mangatsu.amberopener

import android.app.Activity
import android.content.Intent
import android.provider.Browser
import androidx.core.net.toUri
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class OpenAmberUrlArgs {
    lateinit var url: String
}

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
}
