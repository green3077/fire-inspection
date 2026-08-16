package com.joeunfire.inspection;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// 앱 업데이트 확인 시, 새 APK 다운로드 URL을 외부 브라우저(대개 Chrome)에서 열어준다.
// Chrome이 자체 다운로드 관리자로 내려받고, 다운로드 완료 알림을 탭하면 시스템 설치 화면이 뜬다.
// 이 앱이 직접 설치를 실행하는 게 아니라 그냥 URL을 열어주기만 하므로
// REQUEST_INSTALL_PACKAGES 권한이 필요 없다.
@CapacitorPlugin(name = "UpdateBridge")
public class UpdateBridge extends Plugin {
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
