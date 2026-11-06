package org.nimbus.android

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import android.widget.Toast
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

// Home screen widgets. The list widget shows one account's Recent or Starred from a small cache that
// WidgetWorker fills (on app start, account changes, file changes, pushes and polls, and Android's
// half-hourly update). Nothing is shown while the app lock is on; the cache goes with the account.
object Widgets {
  private const val PREFS = "nimbus_widgets"
  const val LIMIT = 20
  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  data class Config(val account: String, val list: String) // list: "recent" | "starred"

  fun config(c: Context, widget: Int): Config? = prefs(c).getString("w.$widget", null)?.let {
    val o = JSONObject(it)
    Config(o.getString("account"), o.getString("list"))
  }

  fun configure(c: Context, widget: Int, cfg: Config) =
    prefs(c).edit().putString("w.$widget", JSONObject().put("account", cfg.account).put("list", cfg.list).toString()).apply()

  fun forget(c: Context, widgets: IntArray) = prefs(c).edit().apply { widgets.forEach { remove("w.$it") } }.apply()

  // JSON [{id, name, kind}] or null before the first fetch.
  fun cached(c: Context, cfg: Config): JSONArray? = prefs(c).getString("c.${cfg.account}.${cfg.list}", null)?.let(::JSONArray)

  private fun listIds(c: Context) =
    AppWidgetManager.getInstance(c).getAppWidgetIds(ComponentName(c, ListWidget::class.java))

  // Fetches fresh lists in the background, then redraws.
  fun refresh(c: Context) {
    if (listIds(c).isEmpty()) return
    val req = OneTimeWorkRequestBuilder<WidgetWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(c).enqueueUniqueWork("widgets", ExistingWorkPolicy.REPLACE, req)
  }

  suspend fun fetch(c: Context) {
    val accounts = Accounts.all(c).associateBy { it.id }
    val wanted = listIds(c).toList().mapNotNull { config(c, it) }.toSet()
    val edit = prefs(c).edit()
    // A signed-out account's cached names go now, not at the next fetch.
    for (key in prefs(c).all.keys) if (key.startsWith("c.") && wanted.none { key == "c.${it.account}.${it.list}" }) edit.remove(key)
    for (cfg in wanted) {
      val acc = accounts[cfg.account] ?: continue
      try {
        val arr = Net.api(acc, "GET", "/api/v1/${cfg.list}?limit=$LIMIT").optJSONArray("items") ?: JSONArray()
        val out = JSONArray()
        for (i in 0 until arr.length()) {
          val o = arr.getJSONObject(i)
          if (!o.isNull("trashedAt")) continue
          out.put(JSONObject().put("id", o.getString("id")).put("name", o.getString("name")).put("kind", o.getString("kind")))
        }
        edit.putString("c.${cfg.account}.${cfg.list}", out.toString())
      } catch (_: Exception) {} // Keep what was there; the next trigger tries again.
    }
    edit.apply()
    withContext(Dispatchers.Main) { update(c) }
  }

  // Redraws every widget from the cache, without the network.
  fun update(c: Context) {
    val wm = AppWidgetManager.getInstance(c)
    for (id in listIds(c)) wm.updateAppWidget(id, listViews(c, id))
    wm.notifyAppWidgetViewDataChanged(listIds(c), R.id.widget_list)
    for (id in wm.getAppWidgetIds(ComponentName(c, ActionsWidget::class.java))) wm.updateAppWidget(id, actionViews(c))
  }

  fun open(c: Context, uri: String, code: Int): PendingIntent =
    PendingIntent.getActivity(c, code, Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(c.packageName),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

  private fun listViews(c: Context, widget: Int): RemoteViews {
    val v = RemoteViews(c.packageName, R.layout.widget_list)
    val cfg = config(c, widget)
    val acc = cfg?.let { Accounts.get(c, it.account) }
    val title = if (cfg?.list == "starred") "Starred" else "Recent"
    v.setTextViewText(R.id.widget_title, title)
    v.setTextViewText(R.id.widget_subtitle, acc?.email?.ifEmpty { null } ?: acc?.let { Uri.parse(it.server).host } ?: "")
    v.setOnClickPendingIntent(R.id.widget_header, open(c, "nimbus://quick?do=home", 0))
    val rows = if (cfg != null && acc != null) cached(c, cfg) else null
    val message = when {
      AppLock.on(c) -> "Hidden while the app lock is on"
      acc == null -> "Sign in to Nimbus to see your files"
      rows == null -> "Loading…"
      rows.length() == 0 -> if (cfg?.list == "starred") "Nothing starred yet" else "Nothing here yet"
      else -> null
    }
    v.setTextViewText(R.id.widget_empty, message ?: "")
    v.setViewVisibility(R.id.widget_empty, if (message != null) View.VISIBLE else View.GONE)
    v.setViewVisibility(R.id.widget_list, if (message == null) View.VISIBLE else View.GONE)
    if (message == null) {
      val svc = Intent(c, WidgetListService::class.java)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widget)
        .setData(Uri.parse("nimbus-widget://$widget")) // one adapter per widget
      v.setRemoteAdapter(R.id.widget_list, svc)
      // Each row fills in its own nimbus:// address.
      val template = PendingIntent.getActivity(c, widget, Intent(Intent.ACTION_VIEW).setPackage(c.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0))
      v.setPendingIntentTemplate(R.id.widget_list, template)
    }
    return v
  }

  private fun actionViews(c: Context) = RemoteViews(c.packageName, R.layout.widget_actions).apply {
    setOnClickPendingIntent(R.id.widget_upload, open(c, "nimbus://quick?do=upload", 1))
    setOnClickPendingIntent(R.id.widget_scan, open(c, "nimbus://quick?do=scan", 2))
  }
}

class ListWidget : AppWidgetProvider() {
  override fun onUpdate(c: Context, wm: AppWidgetManager, ids: IntArray) {
    Widgets.update(c)
    Widgets.refresh(c)
  }
  override fun onDeleted(c: Context, ids: IntArray) = Widgets.forget(c, ids)
}

class ActionsWidget : AppWidgetProvider() {
  override fun onUpdate(c: Context, wm: AppWidgetManager, ids: IntArray) = Widgets.update(c)
}

class WidgetWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    Widgets.fetch(applicationContext)
    Result.success()
  }
}

class WidgetListService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
    Rows(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0))

  private class Rows(val c: Context, val widget: Int) : RemoteViewsFactory {
    private var rows = JSONArray()
    private var account = ""
    override fun onCreate() {}
    override fun onDestroy() {}
    override fun onDataSetChanged() {
      val cfg = Widgets.config(c, widget)
      account = cfg?.account ?: ""
      rows = if (cfg == null || AppLock.on(c)) JSONArray() else Widgets.cached(c, cfg) ?: JSONArray()
    }
    override fun getCount() = rows.length()
    override fun getViewAt(i: Int): RemoteViews {
      val o = rows.getJSONObject(i)
      val folder = o.getString("kind") == "folder"
      // open-notification switches account and opens the folder or file (src/app/open-notification.tsx).
      val uri = Uri.Builder().scheme("nimbus").authority("open-notification")
        .appendQueryParameter("account", account).appendQueryParameter("kind", "widget")
        .appendQueryParameter("href", "").appendQueryParameter("node", o.getString("id")).build()
      return RemoteViews(c.packageName, R.layout.widget_row).apply {
        setTextViewText(R.id.widget_row_name, o.getString("name"))
        setImageViewResource(R.id.widget_row_icon, if (folder) R.drawable.ic_widget_folder else R.drawable.ic_widget_file)
        setOnClickFillInIntent(R.id.widget_row, Intent().setData(uri))
      }
    }
    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount() = 1
    override fun getItemId(i: Int) = i.toLong()
    override fun hasStableIds() = false
  }
}

// Asked when a list widget is placed (or reconfigured): which account, and Recent or Starred.
class WidgetSetup : Activity() {
  override fun onCreate(saved: Bundle?) {
    super.onCreate(saved)
    val widget = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widget))
    val accounts = Accounts.all(this)
    if (widget == AppWidgetManager.INVALID_APPWIDGET_ID || accounts.isEmpty()) {
      Toast.makeText(this, "Sign in to Nimbus first.", Toast.LENGTH_LONG).show()
      return finish()
    }
    val choices = accounts.flatMap { a -> listOf("recent", "starred").map { Widgets.Config(a.id, it) to a } }
    val labels = choices.map { (cfg, a) ->
      val list = if (cfg.list == "starred") "Starred" else "Recent"
      if (accounts.size > 1) "$list · ${a.email.ifEmpty { Uri.parse(a.server).host ?: a.server }}" else list
    }
    AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
      .setTitle("Show in this widget")
      .setItems(labels.toTypedArray()) { _, i ->
        Widgets.configure(this, widget, choices[i].first)
        Widgets.update(this)
        Widgets.refresh(this)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widget))
        finish()
      }
      .setOnCancelListener { finish() }
      .show()
  }
}
