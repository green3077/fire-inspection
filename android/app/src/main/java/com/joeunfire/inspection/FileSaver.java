package com.joeunfire.inspection;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;

// 사용자가 "다운로드한 파일이 어디에 저장되는지 모르겠다"고 해서 만든 플러그인 - 공유 화면(다른 앱으로
// 보내기)과 달리, 이건 안드로이드 표준 "다운로드" 폴더에 실제로 파일을 저장하고 그 위치를 그대로
// 돌려준다. Android 10(API 29) 이상은 MediaStore.Downloads로 저장해야 스코프 저장소 제약을 안 받고
// 사용자가 파일 관리자 앱에서 "다운로드" 폴더를 열면 바로 보인다. 그보다 낮은 버전은 예전 방식대로
// 공용 다운로드 폴더에 직접 쓴다(WRITE_EXTERNAL_STORAGE 권한 필요, 매니페스트에서 maxSdkVersion=28로
// Android 10+에서는 아예 요청하지 않도록 제한).
// 저장 직후 "어떤 프로그램으로 열지" 선택 화면(ACTION_VIEW + 앱 선택 chooser)도 바로 띄워준다 -
// 파일이 잘 저장됐는지, 실제로 한글 프로그램 등에서 정상적으로 열리는지 그 자리에서 바로 확인할 수 있게.
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
            Uri contentUri;
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
                contentUri = item;
            } else {
                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadsDir.exists()) downloadsDir.mkdirs();
                File outFile = new File(downloadsDir, filename);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                }
                displayLocation = outFile.getAbsolutePath();
                contentUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", outFile);
            }
            JSObject ret = new JSObject();
            ret.put("location", displayLocation);
            ret.put("uri", contentUri.toString());
            ret.put("mimeType", mimeType);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("파일 저장 실패: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        String uriStr = call.getString("uri");
        String mimeType = call.getString("mimeType", "*/*");
        if (uriStr == null) {
            call.reject("uri가 필요합니다");
            return;
        }
        try {
            Uri uri = Uri.parse(uriStr);
            Intent viewIntent = new Intent(Intent.ACTION_VIEW);
            viewIntent.setDataAndType(uri, mimeType);
            viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Intent chooser = Intent.createChooser(viewIntent, "다음으로 열기");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (android.content.ActivityNotFoundException e) {
            call.reject("이 파일을 열 수 있는 앱이 설치되어 있지 않습니다");
        } catch (Exception e) {
            call.reject("파일 열기 실패: " + e.getMessage());
        }
    }

    // @capacitor/share의 share()는 URL 확장자로 MIME 타입을 알아내는데(getMimeType() 내부에서
    // MimeTypeMap.getSingleton().getMimeTypeFromExtension() 사용), 안드로이드 시스템은 .hwpx 같은
    // 비표준 확장자를 전혀 모르기 때문에 항상 null → "*/*"로 넘어간다. 카카오톡 등 일부 앱은 받는
    // 파일의 실제 MIME 타입을 안에서 다시 검사해서, "*/*"처럼 모호한 타입으로 온 첨부는 사용자가
    // 골라도 조용히 전송하지 않는 경우가 있다(실제 사용자가 겪은 문제) - 그래서 확장자 추측에 기대지
    // 않고, 우리가 이미 알고 있는 정확한 MIME 타입(예: application/hwp+zip)을 직접 넘겨서
    // ACTION_SEND/ACTION_SEND_MULTIPLE을 구성한다.
    @PluginMethod
    public void shareFiles(PluginCall call) {
        JSArray urisArr = call.getArray("uris");
        String mimeType = call.getString("mimeType", "*/*");
        String title = call.getString("title");
        String dialogTitle = call.getString("dialogTitle", "공유할 앱을 선택하세요");
        if (urisArr == null || urisArr.length() == 0) {
            call.reject("uris가 필요합니다");
            return;
        }
        try {
            ArrayList<Uri> uris = new ArrayList<>();
            for (int i = 0; i < urisArr.length(); i++) {
                Uri parsed = Uri.parse(urisArr.getString(i));
                // Filesystem.writeFile(directory: CACHE)가 돌려주는 uri는 file:// 원본 경로다 - 다른
                // 앱에 그대로 넘기면 Android 7+에서 FileUriExposedException이 난다(FLAG_GRANT_READ_
                // URI_PERMISSION만으로는 안 됨, uri 자체가 content://여야 한다) - FileProvider로 변환한다.
                // 이미 content://로 넘어온 경우(예: saveToDownloads가 돌려준 MediaStore uri)는 그대로 쓴다.
                if ("file".equals(parsed.getScheme())) {
                    File f = new File(parsed.getPath());
                    parsed = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
                }
                uris.add(parsed);
            }
            Intent sendIntent;
            if (uris.size() > 1) {
                sendIntent = new Intent(Intent.ACTION_SEND_MULTIPLE);
                sendIntent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            } else {
                sendIntent = new Intent(Intent.ACTION_SEND);
                sendIntent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            }
            sendIntent.setType(mimeType);
            if (title != null) sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
            sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(sendIntent, dialogTitle);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("공유 실패: " + e.getMessage());
        }
    }
}
