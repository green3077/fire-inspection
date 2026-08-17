package com.joeunfire.inspection;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

// 사용자가 "다운로드한 파일이 어디에 저장되는지 모르겠다"고 해서 만든 플러그인 - 공유 화면(다른 앱으로
// 보내기)과 달리, 이건 안드로이드 표준 "다운로드" 폴더에 실제로 파일을 저장하고 그 위치를 그대로
// 돌려준다. Android 10(API 29) 이상은 MediaStore.Downloads로 저장해야 스코프 저장소 제약을 안 받고
// 사용자가 파일 관리자 앱에서 "다운로드" 폴더를 열면 바로 보인다. 그보다 낮은 버전은 예전 방식대로
// 공용 다운로드 폴더에 직접 쓴다(WRITE_EXTERNAL_STORAGE 권한 필요, 매니페스트에서 maxSdkVersion=28로
// Android 10+에서는 아예 요청하지 않도록 제한).
@CapacitorPlugin(name = "FileSaver")
public class FileSaver extends Plugin {
    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String filename = call.getString("filename");
        String base64Data = call.getString("data");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (filename == null || base64Data == null) {
            call.reject("filename, data가 필요합니다");
            return;
        }
        try {
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
            String displayLocation;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(android.provider.MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(android.provider.MediaStore.Downloads.IS_PENDING, 1);
                Uri item = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (item == null) {
                    call.reject("다운로드 폴더에 저장 위치를 만들지 못했습니다");
                    return;
                }
                try (OutputStream out = resolver.openOutputStream(item)) {
                    if (out == null) throw new java.io.IOException("openOutputStream이 null을 반환했습니다");
                    out.write(bytes);
                }
                values.clear();
                values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(item, values, null, null);
                displayLocation = "다운로드 / " + filename;
            } else {
                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadsDir.exists()) downloadsDir.mkdirs();
                File outFile = new File(downloadsDir, filename);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                }
                displayLocation = outFile.getAbsolutePath();
            }
            JSObject ret = new JSObject();
            ret.put("location", displayLocation);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("파일 저장 실패: " + e.getMessage());
        }
    }
}
