package com.pitchlegends.game;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

/**
 * Pitch Legends - universal Android shell.
 *
 * The whole game is the Vite build copied into assets/www, so this activity only
 * hosts a full-screen WebView and forwards input. It is deliberately free of
 * native code, permissions and platform-specific APIs so the same APK runs on
 * phones, tablets, foldables, Chromebooks and Android TV from API 21 upwards.
 *
 * Input comes from wherever the device provides it: touch (on-screen pad),
 * a Bluetooth/USB controller (standard mapping), or a TV remote mapped to the
 * same key codes as a keyboard. Nothing is required to be present.
 */
public class MainActivity extends android.app.Activity {
    private FrameLayout root;
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // never let the screen sleep mid-match
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF070C16);
        setContentView(root);
        createWebView();

        goImmersive();
        loadGame();
    }

    private void createWebView() {
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        // The game page is served from file:///android_asset, i.e. an opaque
        // ("null") origin. The bundle is a single self-contained page so it
        // needs no subresources at all, but these two keep any file-relative
        // load working instead of being refused by the origin policy.
        try {
            s.setAllowFileAccessFromFileURLs(true);
        } catch (Throwable ignored) {
            // removed in some WebView versions; the inlined page does not need it
        }
        try {
            s.setAllowUniversalAccessFromFileURLs(true);
        } catch (Throwable ignored) {
            // same
        }
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        // the game is 100% local: no network access is needed at all
        s.setBlockNetworkLoads(true);
        // keep the page's own colours on every renderer (old and new WebView)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }
        web.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                // page errors land in `adb logcat` instead of vanishing
                if (m.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.ERROR) {
                    android.util.Log.e("PitchLegends", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                }
                return false;
            }
        });
        web.setBackgroundColor(0xFF070C16);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true; // never navigate away from the bundled game
            }

            @TargetApi(Build.VERSION_CODES.O)
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // a low-memory device can kill the renderer: rebuild instead of crashing
                if (view == web) {
                    root.removeView(web);
                    web.destroy();
                    web = null;
                    createWebView();
                    loadGame();
                }
                return true;
            }
        });
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
        root.addView(web, lp);
    }

    private void loadGame() {
        web.loadUrl("file:///android_asset/www/index.html");
        checkWebGl();
    }

    /**
     * Three.js needs WebGL2. Every Android 5.0+ device with an updatable WebView
     * has it, but a very old or disabled "Android System WebView" does not - in
     * that case show a clear message instead of a black screen.
     */
    @TargetApi(Build.VERSION_CODES.KITKAT)
    private void checkWebGl() {
        web.evaluateJavascript(
            "(function(){try{return !!(document.createElement('canvas').getContext('webgl2'));}catch(e){return false;}})()",
            value -> {
                if (value != null && value.contains("false")) showUnsupported();
            });
    }

    private void showUnsupported() {
        final TextView tv = new TextView(this);
        tv.setText("Pitch Legends needs WebGL 2.\n\n"
            + "Please update \u201CAndroid System WebView\u201D and \u201CChrome\u201D in the Play Store, "
            + "or use a device running Android 5.0 or newer.");
        tv.setTextColor(0xFFE6EDF7);
        tv.setTextSize(16f);
        tv.setPadding(48, 96, 48, 48);
        tv.setBackgroundColor(0xFF070C16);
        root.addView(tv, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }

    /** Hide the status and navigation bars so nothing overlaps the HUD. */
    private void goImmersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goImmersive();
    }

    @Override
    public void onBackPressed() {
        // put the game in the background instead of killing the WebGL context
        moveTaskToBack(true);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) {
            web.onPause();
            web.pauseTimers();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.resumeTimers();
            web.onResume();
        }
        goImmersive();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            root.removeView(web);
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
