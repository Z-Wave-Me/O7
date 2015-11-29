/*

 > {"command": "getVersionRequest"}
 < {"command": "getVersionReply", "data": "v1"}

 > {"command": "getUidRequest"}
 < {"command": "getUidReply", "data": "0123456789abcdef0123456789abcdef"}

 > {"command": "getDevicesRequest"}
 < {"command": "getDevicesReply", "data":[{"id": "ZWayVDev_zway_2", "source": "z-wave", "manufacturerId":316,"productTypeId":1,"productId":1,"productName":0,"elements":[{"id": "ZWayVDev_zway_2-0-37", "deviceType": "switchBinary", "probeType": "", "level": "off", "updateTime":1446564020},{"id": "ZWayVDev_zway_2-0-50-0", "deviceType": "sensorMultilevel", "probeType": "meterElectric_kilowatt_per_hour", "level":0,"updateTime":1446564020},{"id": "ZWayVDev_zway_2-0-50-2", "deviceType": "sensorMultilevel", "probeType": "meterElectric_watt", "level":0,"updateTime":1446564020},{"id": "ZWayVDev_zway_2-0-50-4", "deviceType": "sensorMultilevel", "probeType": "meterElectric_voltage", "level":228.7000064,"updateTime":1446564020},{"id": "ZWayVDev_zway_2-0-50-5", "deviceType": "sensorMultilevel", "probeType": "meterElectric_ampere", "level":0,"updateTime":1446564020},{"id": "ZWayVDev_zway_2-0-50-6", "deviceType": "sensorMultilevel", "probeType": "meterElectric_power_factor", "level":0,"updateTime":1446564020}]}]}

 < {"command": "deviceUpdate", "data":{"id": "ZWayVDev_zway_2", "source": "z-wave", "manufacturerId":316,"productTypeId":1,"productId":1,"productName":0,"elements":[{"id": "ZWayVDev_zway_2-0-37", "deviceType": "switchBinary", "probeType": "", "level": "off", "updateTime":1446564883},{"id": "ZWayVDev_zway_2-0-50-0", "deviceType": "sensorMultilevel", "probeType": "meterElectric_kilowatt_per_hour", "level":0,"updateTime":1446564820},{"id": "ZWayVDev_zway_2-0-50-2", "deviceType": "sensorMultilevel", "probeType": "meterElectric_watt", "level":0,"updateTime":1446564820},{"id": "ZWayVDev_zway_2-0-50-4", "deviceType": "sensorMultilevel", "probeType": "meterElectric_voltage", "level":228.7000064,"updateTime":1446564820},{"id": "ZWayVDev_zway_2-0-50-5", "deviceType": "sensorMultilevel", "probeType": "meterElectric_ampere", "level":0,"updateTime":1446564820},{"id": "ZWayVDev_zway_2-0-50-6", "deviceType": "sensorMultilevel", "probeType": "meterElectric_power_factor", "level":0,"updateTime":1446564820}]}}

 > {"command": "setHomeMode", "data": "away"}

 > {"command": "getHomeModeRequest"}
 < {"command": "getHomeModeReply", "data":{"homeMode": "away"}}

 > {"command": "deviceAction", "data": {"id": "ZWayVDev_zway_2-0-37", "command": "on"}}

 > {"command": "deviceAction", "data": {"id": "ZWayVDev_zway_2-0-38", "command": "exact", "args": {"“}

 */


// main O7 object constructor
function O7() {
  var self = this;

  this.O7_UUID = "98b6d6b7-83d7-4e4e-9019-80a50b1ce9e5";
  this.O7_PROTOCOL = "ws";
  this.O7_HOST     = "smart.local";
  this.O7_PORT     = 4783;
  this.O7_PATH     = "/?uuid=98b6d6b7-83d7-4e4e-9019-80a50b1ce9e5&token=auth_token&source=controller";

  this.O7_WS = this.O7_PROTOCOL + "://" + this.O7_HOST + (this.O7_PORT.toString().length > 0 ? ":" + this.O7_PORT : "") + this.O7_PATH;

  this.RECONNECT_PERIOD = 7;

  /* TODO Change to WS Server
   this.server_clients = [];
   this.server_sock = new sockets.tcp();

   this.server_sock.bind(this.O7_PORT);
   this.server_sock.onconnect = function(host, port) {
   this.buffer = "";
   self.debug("New client: " + host + ":" + port);
   if (self.server_clients.indexOf(this) === -1) {
   self.server_clients.push(this);
   }
   };
   this.server_sock.onclose = function(host, port) {
   var indx = self.server_clients.indexOf(this);
   if (indx !== -1) {
   delete self.server_clients[indx];
   }
   };
   this.server_sock.onrecv = function(data, host, port) {
   self.handleRecv(this, data);
   };
   this.server_sock.listen();
   */

  this.clientConnect();

  this.devices = new O7Devices();

  // catch newly created devices
  controller.devices.on('created', function(vDev) {
    self.addDevice.call(self, vDev);
  });

  // enumerate existing devices
  controller.devices.forEach(function(vDev) {
    self.addDevice.call(self, vDev);
  });
}

O7.prototype.error = function() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift("[O7] Error");
  console.log(args);
};

O7.prototype.warning = function() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift("[O7] Warning");
  console.log(args);
};

O7.prototype.debug = function() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift("[O7] Debug");
  console.log(args);
};

O7.prototype.notImplemented = function(name) {
  console.log("Warining:", "Function \"" + name + "\" not implementeda");
};

/**
 * Handle received message
 *
 * @param sock websocket
 * @param message JSON-string
 */
O7.prototype.handleRecv = function(sock, message) {
  this.debug("Received: " + message);
  this.parseMessage(sock, message);
};


O7.prototype.clientConnect = function() {
  var self = this;

  this.client_sock = new sockets.websocket(this.O7_WS);

  this.client_sock.onconnect = function() {
    // После установки соединения с ws-сервером, он начинает каждые 3 сек слать
    // heartbeat-сообщения {"identifier":"_ping","message":текущий_timestamp}

    // Subscription for channel
    self.sendObjToSock(this, {}, "subscribe");

    // PING-PONG
    self.sendObjToSock(this, {action: "pong"});

  };


  this.client_sock.onmessage = function(ev) {
    self.debug(' Message: ' + JSON.stringify(ev.data));
    self.handleRecv(this, ev.data);
  };


  this.client_sock.onclose = function() {
    self.debug("Closing client socket");
    //this.close(); // TODO Wait for bug fix in WS close
    self.client_sock = null;
  };

  this.client_sock.onerror = function(ev) {
    self.error("Willing to close client socket: " + ev.data);
    //this.close(); // TODO Wait for bug fix in WS close
    self.client_sock = null;
  };

  /**
   * Reconnect `RECONNECT_PERIOD` seconds
   */
  setInterval(function() {
    // TODO: Make connection status check
    if(self.client_sock == null) {
      self.debug("Reconnecting...");
      self.clientConnect();
    }
  }, this.RECONNECT_PERIOD*1000);

};


/**
 *
 * @param sock WS-object
 * @param message Client message
 */
O7.prototype.parseMessage = function(sock, message) {
  this.debug("Parsing: " + message);
  var self = this,
      obj  = JSON.parse(message),
      msg  = typeof(obj.message) == 'undefined' ? {action: 'ping'} : obj.message,
      act  = msg.action;


  delete msg.action;

  this.debug("ACTION: " + act);

  switch (act) {
    case "getVersionRequest":
      this.sendObjToSock(sock, {
        action: "getVersionReply",
        data: "v1"});
      break;
    case "getUidRequest":
      this.sendObjToSock(sock, {
        action: "getUidReply",
        data: "98b6d6b7-83d7-4e4e-9019-80a50b1ce9e5" // Example GUID
      });
      break;
    case "getHomeModeRequest":
      this.sendObjToSock(sock, {
        command: "getHomeModeReply",
        data: this.getHomeMode()
      });
      break;
    case "setHomeMode":
      this.setHomeMode(msg.data);
      break;
    case "deviceAction":
      var vDev = controller.devices.get(msg.id);
      if (vDev) {
        vDev.performCommand(msg.command, msg.args);
      } else {
        this.error("VDev not found");
      }
      break;
    case "getDevicesRequest":
      this.sendObjToSock(sock, {
        action: "getDevicesReply",
        data: this.JSONifyDevices()
      });
      break;
    case "getDeviceRequest":
      this.sendObjToSock(sock, {
        action: "getDeviceReply",
        data: this.JSONifyDevice(obj.data)
      });
      break;
    case "deviceAdd":
      break;
    case "deviceRemove":
      break;
    case "setScenarii":
      break;

    case "ping":
      break;
  }
};

O7.prototype.addDevice = function(vDev) {
  var pattern = "(ZWayVDev_([^_]+)_([0-9]+))-([0-9]+)((-[0-9]+)*)",
      match = vDev.id.match(pattern),
      self = this;

  if (match) {
    var id = match[1],
        zwayName = match[2],
        zwayId = parseInt(match[3]),
        o7dev = this.devices.get(id);

    var _dev = this.devices.add({
      id: id,
      zwayName: zwayName,
      zwayId: zwayId
    });

    _dev.add({
      id: vDev.id
    });

    vDev.on("change:metrics:level", function(vdev) {
      self.debug("Device changed: " + vdev.id);
      self.notifyDeviceChange(vdev.id);
    });
  }
};

O7.prototype.getMasterDevice = function(id) {
  var pattern = "(ZWayVDev_([^_]+)_([0-9]+))-([0-9]+)((-[0-9]+)*)",
      match = id.match(pattern);

  return match && match[1] || "";
};

/**
 *
 * @param sock WS-client instance
 * @param obj Data for sending
 */
O7.prototype.sendObjToSock = function(sock, obj, command) {
  command = typeof(command) == 'undefined' ? 'message' : command;

  var data = {
    identifier: "{\"channel\": \"ZwayChannel\", \"uuid\": \"98b6d6b7-83d7-4e4e-9019-80a50b1ce9e5\"}", // uuid подставить рельаный
    command: command,
    data: JSON.stringify(obj) // ВАЖНО: data - это json-строка, а не объект
  }, message = JSON.stringify(data);


  if(sock != null) {
    this.debug('Send: ' + message);
    sock.send(message);
  } else {
    this.error("No WS-connection for sending message: " + message);
  }

};

/**
 * Notification about device change state
 * @param id Device ID
 */
O7.prototype.notifyDeviceChange = function(id) {
  var data = this.JSONifyDevice(this.getMasterDevice(id));
  data.action = "deviceUpdate";

  try {
    this.client_sock && this.sendObjToSock(this.client_sock, data);
  } catch(e) {
    this.error("Socket send error: " + e);
  }

  /* TODO Change to WS server
   for (var i in this.server_clients) {
   try {
   this.sendObjToSock(this.server_clients[i], {
   command: "deviceUpdate",
   data: this.JSONifyDevice(this.getMasterDevice(id))
   });
   } catch(e) {
   this.error("Socket send error: " + e);
   }
   }
   */
};

O7.prototype.JSONifyDevice = function(id) {
  var dev = this.devices.get(id);

  if (dev) {
    return this.deviceToJSON(dev);
  }

  return null;
};

O7.prototype.deviceToJSON = function(dev) {
  if (!dev || !dev.id || !dev.zwayName || !dev.zwayId) {
    return this.error("Illegal arguments");
  }

  var zway = ZWave[dev.zwayName] && ZWave[dev.zwayName].zway,
      zData = zway && zway.devices[dev.zwayId] && zway.devices[dev.zwayId].data || null;

  if (zData == null) {
    return this.error("device structure exists, but zway device does not");
  }

  var ret = {
    id: dev.id,
    source: "z-wave",
    manufacturerId: zData.manufacturerId.value,
    productTypeId: zData.manufacturerProductType.value,
    productId: zData.manufacturerProductId.value,
    productName: zData.vendorString.value | "",
    elements: []
  };

  dev.subdevices.forEach(function (subdev) {
    var _vDev = controller.devices.get(subdev.id);
    if (!_vDev) return;

    var deviceType = _vDev.get("deviceType"),
        probeType = _vDev.get("probeType");

    // refactor device/probe types to fit O7 tpyes
    if (deviceType === "battery") {
      deviceType = "sensorMultilevel";
      probeType = "battery";
    }

    var _subdev = {
      id: subdev.id,
      deviceType: deviceType,
      probeType: probeType || "",
      level: _vDev.get("metrics:level"),
      /* TODO
       [color: r: <int>, g: <int>, b: <int>]("switchColor"),
       [max: <int>]("switchMultilevel"),
       [min: <int>]("switchMultilevel"),
       */
      updateTime: _vDev.get("updateTime")
    };

    ret.elements.push(_subdev);
  });

  return ret;
};

O7.prototype.JSONifyDevices = function() {
  return this.devices.devices.map(this.deviceToJSON);
};

// Subdevice object

O7SubDevice = function (prop) {
  this.id = prop && prop.id || 0;
  // !!! add metrics here
};

// Device object

O7Device = function (prop) {
  this.id = prop && prop.id || 0;
  this.zwayName =  prop && prop.zwayName || "";
  this.zwayId =  prop && prop.zwayId || 0;
  // !!! add manufacturer data here
  this.subdevices = [];
};

O7Device.prototype.get = function(id) {
  var _subdevs = this.subdevices.filter(function(subdev) {
    return subdev.id == id;
  });

  return _subdevs.length > 0 ? _subdevs[0] : null;
};

O7Device.prototype.add = function(prop) {
  if (!prop || !prop.id) return;

  var _subdev = this.get(prop.id);
  if (_subdev) return _subdev;

  var _subdev = new O7SubDevice(prop);
  this.subdevices.push(_subdev);
  return _subdev;
};

// O7Devices class to operate with devices
function O7Devices() {
  this.devices = [];
}

O7Devices.prototype.get = function(id) {
  var _devs = this.devices.filter(function(dev) {
    return dev.id == id;
  });

  return _devs.length > 0 ? _devs[0] : null;
};

O7Devices.prototype.add = function(prop) {
  if (!prop || !prop.id) return;

  var _dev = this.get(prop.id);
  if (_dev) return _dev;

  var _dev = new O7Device(prop);
  this.devices.push(_dev);
  return _dev;
};

// Home Mode
O7.prototype.getHomeMode = function() {
  return {
    homeMode: this.homeMode
  };
};

O7.prototype.setHomeMode = function(mode) {
  this.homeMode = mode;
};

var o7 = new O7();

