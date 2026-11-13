package app.freedomfi.sms

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject

/**
 * Queue of money-alert SMS waiting for FreedomFi to read them.
 * FreedomFi acknowledges messages after adding them, which removes them from here.
 */
object PendingStore {
    private const val PREFS = "freedomfi_pending"
    private const val KEY = "items"
    private const val MAX_ITEMS = 2000

    @Volatile
    var listener: (() -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())

    private fun load(ctx: Context): JSONArray {
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
        return try { if (raw == null) JSONArray() else JSONArray(raw) } catch (e: Exception) { JSONArray() }
    }

    private fun save(ctx: Context, arr: JSONArray) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, arr.toString()).apply()
    }

    private fun idFor(sender: String, body: String, ts: Long) = "$ts:${(sender + body).hashCode()}"

    /** Returns true if the message was new. */
    @Synchronized
    fun add(ctx: Context, sender: String, body: String, ts: Long): Boolean {
        val id = idFor(sender, body, ts)
        val arr = load(ctx)
        for (i in 0 until arr.length()) if (arr.getJSONObject(i).optString("id") == id) return false
        arr.put(JSONObject().put("id", id).put("sender", sender).put("body", body).put("ts", ts))
        // Keep memory bounded: drop the oldest if the app has not been opened for a very long time.
        val trimmed = if (arr.length() > MAX_ITEMS) {
            JSONArray().also { out -> for (i in arr.length() - MAX_ITEMS until arr.length()) out.put(arr.get(i)) }
        } else arr
        save(ctx, trimmed)
        return true
    }

    @Synchronized
    fun json(ctx: Context): String = load(ctx).toString()

    @Synchronized
    fun remove(ctx: Context, ids: Set<String>) {
        if (ids.isEmpty()) return
        val arr = load(ctx)
        val out = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("id") !in ids) out.put(o)
        }
        save(ctx, out)
    }

    fun notifyChanged() {
        main.post { listener?.invoke() }
    }
}
