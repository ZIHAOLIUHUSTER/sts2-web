package com.sts2web.game;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
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
import java.util.Collections;
import java.nio.charset.StandardCharsets;
import java.io.OutputStream;
import org.json.JSONObject;

/** A local HTTPS origin keeps fetch, WebGL and IndexedDB working without changing the game. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
    private ValueCallback<Uri[]> fileChooser;
    private byte[] backupData;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
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
                    return new WebResourceResponse(mime, null, 200, "OK",
                        Collections.singletonMap("Cache-Control", "no-store"),
                        getAssets().open("web" + path));
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
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
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
        if (web != null && level >= TRIM_MEMORY_RUNNING_LOW)
            web.evaluateJavascript("window.dispatchEvent(new Event('sts2-memory-pressure'))", null);
    }

    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
}
