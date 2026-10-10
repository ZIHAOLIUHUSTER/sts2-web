package com.sts2web.game;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.FrameMetrics;
import android.view.Window;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.SequenceInputStream;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Arrays;
import java.nio.charset.StandardCharsets;
import java.io.OutputStream;
import org.json.JSONObject;

/** A local HTTPS origin keeps fetch, WebGL and IndexedDB working without changing the game. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
    private ValueCallback<Uri[]> fileChooser;
    private byte[] backupData;
    private String apkVersion;
    private String webViewVersion = "unknown";
    private float displayRefreshHz;
    private final AssetCache assetCache = new AssetCache();
    private final FrameDiagnostics frames = new FrameDiagnostics();
    private HandlerThread frameThread;
    private Window.OnFrameMetricsAvailableListener frameListener;
    private boolean frameListenerAttached;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        try { apkVersion = Integer.toString(getPackageManager().getPackageInfo(getPackageName(), 0).versionCode); }
        catch (android.content.pm.PackageManager.NameNotFoundException e) { apkVersion = "unknown"; }
        android.content.pm.PackageInfo provider = WebView.getCurrentWebViewPackage();
        if (provider != null) webViewVersion = provider.packageName + " " + provider.versionName;
        displayRefreshHz = getWindowManager().getDefaultDisplay().getRefreshRate();
        web = new WebView(this);
        web.setBackgroundColor(0xff000000);
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new BackupBridge(), "Sts2Android");
        WebView.setWebContentsDebuggingEnabled(true); // This first APK is a debug build.
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path == null || path.contains("..")) return missing();
                if (path.endsWith("/")) path += "index.html";
                if (path.equals("/wiki")) path = "/wiki/index.html";
                // Everything is already in the APK; skip the website's duplicate offline cache.
                if (path.equals("/sw.js")) return missing();
                String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase(java.util.Locale.ROOT);
                String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                if (extension.equals("js")) mime = "application/javascript";
                if (extension.equals("json")) mime = "application/json";
                if (mime == null) mime = "application/octet-stream";
                try {
                    Map<String, String> headers = new LinkedHashMap<>();
                    // Stable asset URLs survive APK updates. Always revalidate against this APK;
                    // a changed version changes the validator without clearing WebView/save data.
                    headers.put("Cache-Control", extension.equals("html") ? "no-store" : "no-cache, must-revalidate");
                    headers.put("ETag", "\"apk-" + apkVersion + "-" + Integer.toHexString(path.hashCode()) + "\"");
                    return new WebResourceResponse(mime, null, 200, "OK", headers,
                        assetCache.open(path));
                } catch (IOException e) { return missing(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooser != null) fileChooser.onReceiveValue(null);
                fileChooser = callback;
                try { startActivityForResult(params.createIntent(), 1); }
                catch (ActivityNotFoundException e) { fileChooser.onReceiveValue(null); fileChooser = null; }
                return true;
            }
        });
        fullscreen();
        web.loadUrl("https://" + HOST + "/index.html");
        frameThread = new HandlerThread("window-frame-diagnostics");
        frameThread.start();
        frameListener = (window, metrics, dropped) -> frames.record(metrics, dropped);
    }

    /** Small APK text resources are inflated once per process. Binary/large files stay streaming. */
    private final class AssetCache {
        private static final int MAX_ITEM = 256 * 1024;
        private static final int MAX_BYTES = 8 * 1024 * 1024;
        private final LinkedHashMap<String, byte[]> entries = new LinkedHashMap<>(16, 0.75f, true);
        private int bytes;
        private long hits;
        private long misses;

        InputStream open(String path) throws IOException {
            synchronized (this) {
                byte[] cached = entries.get(path);
                if (cached != null) { hits++; return new ByteArrayInputStream(cached); }
                misses++;
            }
            InputStream source = getAssets().open("web" + path);
            boolean textResource = path.endsWith(".json") || path.endsWith(".js") || path.endsWith(".css")
                || path.endsWith(".svg") || path.endsWith(".txt") || path.endsWith(".atlas")
                || path.endsWith(".glsl");
            // Avoid a second compressed-byte cache for texture/audio/font resources.
            if (!textResource) return source;
            // AssetInputStream.available() reports the remaining APK asset length. Keep the
            // bounded read below as a second guard; never decode or hold large textures here.
            if (source.available() > MAX_ITEM) return source;
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int count;
            try {
                while ((count = source.read(chunk, 0, Math.min(chunk.length, MAX_ITEM + 1 - buffer.size()))) != -1) {
                    buffer.write(chunk, 0, count);
                    if (buffer.size() > MAX_ITEM)
                        return new SequenceInputStream(new ByteArrayInputStream(buffer.toByteArray()), source);
                }
            } catch (IOException e) { source.close(); throw e; }
            source.close();
            byte[] content = buffer.toByteArray();
            synchronized (this) {
                byte[] existing = entries.get(path);
                if (existing == null) {
                    while (bytes + content.length > MAX_BYTES && !entries.isEmpty()) {
                        String oldest = entries.keySet().iterator().next();
                        bytes -= entries.remove(oldest).length;
                    }
                    entries.put(path, content);
                    bytes += content.length;
                } else content = existing;
            }
            return new ByteArrayInputStream(content);
        }

        synchronized void clear() { entries.clear(); bytes = 0; }
        synchronized JSONObject snapshot() throws org.json.JSONException {
            return new JSONObject().put("bytes", bytes).put("limitBytes", MAX_BYTES)
                .put("entries", entries.size()).put("hits", hits).put("misses", misses);
        }
    }

    /** Window/UI frame durations, NOT WebGL FPS or JS frame time. No per-frame JS calls. */
    private static final class FrameDiagnostics {
        private final long[] durations = new long[120];
        private int cursor;
        private int size;
        private final long[] intervals = new long[120];
        private int intervalCursor;
        private int intervalSize;
        private long lastVsync;
        private long samples;
        private long missedCallbacks;
        private long lastSampleAt;

        synchronized void record(FrameMetrics metrics, int dropped) {
            long duration = metrics.getMetric(FrameMetrics.TOTAL_DURATION);
            if (duration < 0) return;
            durations[cursor] = duration;
            cursor = (cursor + 1) % durations.length;
            size = Math.min(size + 1, durations.length);
            samples++;
            missedCallbacks += dropped;
            long vsync = metrics.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP);
            // Missing callbacks and background/idle gaps cannot be interpreted as frame pacing.
            long interval = vsync - lastVsync;
            if (lastVsync > 0 && dropped == 0 && interval > 0 && interval < 250000000L) {
                intervals[intervalCursor] = interval;
                intervalCursor = (intervalCursor + 1) % intervals.length;
                intervalSize = Math.min(intervalSize + 1, intervals.length);
            }
            lastVsync = vsync;
            lastSampleAt = android.os.SystemClock.elapsedRealtime();
        }

        synchronized void resetCadence() { lastVsync = 0; }

        synchronized JSONObject snapshot() throws org.json.JSONException {
            long[] sorted = Arrays.copyOf(durations, size);
            Arrays.sort(sorted);
            long[] sortedIntervals = Arrays.copyOf(intervals, intervalSize);
            Arrays.sort(sortedIntervals);
            return new JSONObject().put("source", "android-window-total-duration")
                .put("sampleCount", size).put("totalSamples", samples)
                .put("missedCallbacks", missedCallbacks)
                .put("lastSampleAgeMs", lastSampleAt == 0 ? -1 : android.os.SystemClock.elapsedRealtime() - lastSampleAt)
                .put("medianMs", size == 0 ? 0 : sorted[(size - 1) / 2] / 1000000.0)
                .put("p95Ms", size == 0 ? 0 : sorted[(int) Math.ceil(size * 0.95) - 1] / 1000000.0)
                .put("maxMs", size == 0 ? 0 : sorted[size - 1] / 1000000.0)
                .put("cadenceSource", "android-window-intended-vsync-interval")
                .put("cadenceSamples", intervalSize)
                .put("cadenceMedianMs", intervalSize == 0 ? 0 : sortedIntervals[(intervalSize - 1) / 2] / 1000000.0)
                .put("cadenceP95Ms", intervalSize == 0 ? 0 : sortedIntervals[(int) Math.ceil(intervalSize * 0.95) - 1] / 1000000.0);
        }
    }

    private void attachFrameListener() {
        if (frameListener != null && !frameListenerAttached) {
            getWindow().addOnFrameMetricsAvailableListener(frameListener, new Handler(frameThread.getLooper()));
            frameListenerAttached = true;
        }
    }

    private void detachFrameListener() {
        if (frameListenerAttached) {
            getWindow().removeOnFrameMetricsAvailableListener(frameListener);
            frameListenerAttached = false;
            frames.resetCadence();
        }
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
    }

    private void fullscreen() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) fullscreen();
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else web.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))", null);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 2 && backupData != null) {
            final byte[] bytes = backupData;
            backupData = null;
            if (result != RESULT_OK || data == null || data.getData() == null) {
                backupResult("cancelled");
                return;
            }
            final Uri uri = data.getData();
            new Thread(() -> {
                String error = "";
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IOException("Cannot open backup destination");
                    out.write(bytes);
                } catch (IOException | RuntimeException e) { error = "write failed"; }
                final String resultError = error;
                runOnUiThread(() -> backupResult(resultError));
            }, "save-backup").start();
            return;
        }
        if (request == 1 && fileChooser != null) {
            fileChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileChooser = null;
        }
    }

    /** Only the packaged page can navigate inside this WebView; no filesystem path is exposed to JS. */
    public final class BackupBridge {
        /** Read on demand (e.g. once when exporting diagnostics), never each render frame. */
        @JavascriptInterface public String getDiagnostics() {
            try {
                return new JSONObject().put("apkVersion", apkVersion).put("webView", webViewVersion)
                    .put("androidSdk", android.os.Build.VERSION.SDK_INT).put("displayRefreshHz", displayRefreshHz)
                    .put("windowFrames", frames.snapshot()).put("apkResources", assetCache.snapshot()).toString();
            } catch (org.json.JSONException e) { return "{}"; }
        }

        @JavascriptInterface public void exportBackup(String filename, String json) {
            runOnUiThread(() -> {
                if (backupData != null) return;
                backupData = json.getBytes(StandardCharsets.UTF_8);
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, filename.replaceAll("[^a-zA-Z0-9._-]", "_"));
                try { startActivityForResult(intent, 2); }
                catch (RuntimeException e) { backupData = null; backupResult("no file picker"); }
            });
        }
    }

    private void backupResult(String error) {
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('sts2-backup-result',{detail:"
            + JSONObject.quote(error) + "}))", null);
    }

    @Override public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= TRIM_MEMORY_RUNNING_LOW) {
            assetCache.clear();
            if (web != null)
                web.evaluateJavascript("window.dispatchEvent(new Event('sts2-memory-pressure'))", null);
        }
    }

    @Override protected void onPause() { detachFrameListener(); web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); attachFrameListener(); }
    @Override protected void onDestroy() {
        detachFrameListener();
        if (frameThread != null) frameThread.quitSafely();
        assetCache.clear();
        super.onDestroy();
    }
}
