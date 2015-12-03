== Installing

Requires Z-Way version v2.1.2-rc14-internal-3-g7f0b962 or upper.

Copy the file into /opt/z-way-server/automation/.
Edit /opt/z-way-server/automation/main.js and add at the end line:

executeFile("O7-sock.js");


== WebSocket Server usage

Example on browser side:

var socket = new WebSocket("ws://192.168.0.32:4783/");

socket.onclose = function(event) {
  if (event.wasClean) {
    console.log('Соединение закрыто чисто');
  } else {
    console.log('Обрыв соединения'); // например, "убит" процесс сервера
  }
  console.log('Код: ' + event.code + ' причина: ' + event.reason);
};

socket.onmessage = function(event) {
  console.log("Получены данные " + event.data);
};

socket.onerror = function(error) {
  console.log("Ошибка " + error.message);
};

socket.onopen = function() {
  socket.send(JSON.stringify({"command":"message","identifier":"{\"channel\":\"ZwayChannel\",\"uuid\":\"058943ba-97b0-4b6c-3f85-e130592feaeb\"}","message":{"action":"getDevicesRequest"}}));
};

// after socket is connected:

socket.send(JSON.stringify({"command":"message","identifier":"{\"channel\":\"ZwayChannel\",\"uuid\":\"058943ba-97b0-4b6c-3f85-e130592feaeb\"}","message":{"action":"deviceAction","id":"ZWayVDev_zway_6-0-37","command":"off"}}));
