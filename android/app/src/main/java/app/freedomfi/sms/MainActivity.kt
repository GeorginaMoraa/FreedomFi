package app.freedomfi.sms

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import kotlin.concurrent.thread

/**
 * Hosts the FreedomFi website (bundled in assets) in a WebView and exposes a small bridge,
 * `window.FreedomAndroid`, that only the bundled pages can use.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    private val host = "appassets.androidplatform.net"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val loader = WebViewAssetLoader.Builder()
            .setDomain(host)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true            // FreedomFi keeps its data in localStorage
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            // Never navigate inside the app to anything but our own pages.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == host) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) {}
                return true
            }
        }

        web.addJavascriptInterface(Bridge(), "FreedomAndroid")

        if (savedInstanceState == null) web.loadUrl("https://$host/assets/index.html")
        else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        PendingStore.listener = { tellWeb("window.onNewSms && window.onNewSms()") }
        tellWeb("window.onNewSms && window.onNewSms()")
    }

    override fun onPause() {
        PendingStore.listener = null
        super.onPause()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private fun tellWeb(js: String) = runOnUiThread { web.evaluateJavascript(js, null) }

    private fun hasSmsPermission() =
        checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED &&
        checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

    @Deprecated("Deprecated in Java")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        tellWeb("window.onSmsPermission && window.onSmsPermission()")
    }

    inner class Bridge {
        @JavascriptInterface
        fun hasPermission(): Boolean = hasSmsPermission()

        @JavascriptInterface
        fun requestPermission() {
            runOnUiThread {
                requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS), 101)
            }
        }

        @JavascriptInterface
        fun getPending(): String = PendingStore.json(this@MainActivity)

        @JavascriptInterface
        fun ack(idsJson: String) {
            try {
                val arr = JSONArray(idsJson)
                val ids = HashSet<String>()
                for (i in 0 until arr.length()) ids.add(arr.getString(i))
                PendingStore.remove(this@MainActivity, ids)
            } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun scanInbox(days: Int) {
            if (!hasSmsPermission()) return
            val app = applicationContext
            thread {
                try { InboxScanner.scan(app, days) } catch (_: Exception) {}
                tellWeb("window.onNewSms && window.onNewSms()")
            }
        }
    }
}
