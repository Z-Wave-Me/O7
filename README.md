== Installing

Requires Z-Way version v2.1.2-rc14-internal-3-g7f0b962 or upper.

Copy the file into /opt/z-way-server/automation/.
Edit /opt/z-way-server/automation/main.js and add at the end line:

```javascript
executeFile("O7-sock.js");
```

== WebSocket Server usage

Example on the browser side:

```javascript
var socket = new WebSocket("ws://192.168.0.32:4783/");

socket.onclose = function(event) {
  if (event.wasClean) {
    console.log('Connection close');
  } else {
    console.log('Connection dropped by server');
  }
  console.log('Code: ' + event.code + ' reason: ' + event.reason);
};

socket.onmessage = function(event) {
  console.log("Received " + event.data);
};

socket.onerror = function(error) {
  console.log("Error " + error.message);
};

socket.onopen = function() {
  socket.send(JSON.stringify({"command":"message","identifier":"{\"channel\":\"ZwayChannel\",\"uuid\":\"058943ba-97b0-4b6c-3f85-e130592feaeb\"}","message":{"action":"getDevicesRequest"}}));
};

// after socket is connected:

socket.send(JSON.stringify({"command":"message","identifier":"{\"channel\":\"ZwayChannel\",\"uuid\":\"058943ba-97b0-4b6c-3f85-e130592feaeb\"}","message":{"action":"deviceAction","id":"ZWayVDev_zway_6-0-37","command":"off"}}));
```
