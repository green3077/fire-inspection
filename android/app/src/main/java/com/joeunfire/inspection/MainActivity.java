package com.joeunfire.inspection;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(UpdateBridge.class);
        super.onCreate(savedInstanceState);
    }
}
