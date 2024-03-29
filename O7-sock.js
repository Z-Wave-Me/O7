// main O7 object constructor
function O7() {
  var self = this;

  // Save Z-Way context for future use
  var zwayObj = this.getMainZWay();
  if (zwayObj === null) {
    return;
  }
  this.zway = zwayObj.zway;
  this.zwayName = zwayObj.zwayName;

  this.swVersion = this.zway.controller.data.softwareRevisionVersion.value;
  this.swCommit = this.zway.controller.data.softwareRevisionId.value;
  this.swDate = this.zway.controller.data.softwareRevisionDate.value;
  this.hwVersion = this.zway.controller.data.APIVersion.value;

  if (typeof PhilioHW !== "undefined" && PhilioHW && PhilioHW.nervous) {
    var _philioInstance = controller.getInstancesByModuleName(PhilioHW.name)[0];
    self.LEDconnected = function(val) {
      _philioInstance && _philioInstance.nervous(val);
    };
  } else {
    self.LEDconnected = function(val) {};
  }

  if (!sockets.websocket) {
    this.error("Websockets are not supported. Stopping.");
    return;
  }

  this.O7_UUID = this.formatUUID(this.zway.controller.data.uuid.value);
  this.O7_MAC = this.readMAC();
  this.O7_OS_VER = this.readOSVersion();
  this.O7_PROTOCOL = "ws";
  this.O7_HOST     = "smart.local";
  this.O7_PORT     = 4080;
  this.O7_TOKEN = this.getToken();
  this.O7_SSL_CA = null;
  this.O7_SSL_CERT = null;
  this.O7_SSL_KEY = null;

  this.O7_PATH     = "/?uuid=" + this.O7_UUID + "&token=" + this.O7_TOKEN + "&source=controller";

  this.O7_WS = this.O7_PROTOCOL + "://" + this.O7_HOST + (this.O7_PORT.toString().length > 0 ? ":" + this.O7_PORT : "") + this.O7_PATH;

  this.RECONNECT_PERIOD = 7;
  this.PING_TIMEOUT = 30;

  this.O7_BUFFERED_EVENTS_LENGTH = 1000;

  this.RULES_MAX_PER_SECOND = 3;
  this.rulesCounter = {};
  this.rulesCounterTimer = setInterval(function() {
    self.rulesCounter = {};
  }, 5000);
  
  this.debug("UID: " + this.O7_UUID);
  this.debug("Token: " + this.O7_TOKEN);
  this.debug("MAC: " + this.O7_MAC);
  this.debug("OS Ver: " + this.O7_OS_VER);
  this.debug("Server: " + this.O7_PROTOCOL + "://" + this.O7_HOST + (this.O7_PORT.toString().length > 0 ? ":" + this.O7_PORT : ""));

  // start server for local clients
  this.server_clients = [];
  this.server_sock = new sockets.websocket(this.O7_PORT);

  this.server_sock.onconnect = function() {
    self.debug("New client connected");
    if (self.server_clients.indexOf(this) === -1) {
      self.server_clients.push(this);
    }
  };
  this.server_sock.onclose = function() {
    if (this === self.server_sock) {
      self.debug("Closing server");
    } else {
      var indx = self.server_clients.indexOf(this);
      if (indx !== -1) {
        delete self.server_clients[indx];
      }
    }
  };
  this.server_sock.onerror = function(e) {
    self.debug("Client error: " + e);
  };
  this.server_sock.onmessage = function(ev) {
    self.parseMessage(this, ev.data);
  };

  // start UDP broadcast UUID discovery service
  this.server_discovery = new sockets.udp();
  this.server_discovery.reusable();
  this.server_discovery.bind("255.255.255.255", 4444);
  this.server_discovery.onrecv = function(data, host, port) {
    this.sendto('{"uuid": "' + self.O7_UUID +  '"}', host, port);
  };
  this.server_discovery.listen();

  // incoming buffer
  this.data_fragments = '';
  
  // connect to O7
  this.clientConnect();

  // create vDev <=> O7 Dev bindings
  this.devices = new O7Devices();

  // create controller device
  this.devices.add({
    id: "CtrlVDev"
  });

  // catch newly created devices
  controller.devices.on('created', function(vDev) {
    self.addDevice.call(self, vDev);
  });

  // enumerate existing devices
  controller.devices.forEach(function(vDev) {
    self.addDevice.call(self, vDev);
  });

  // Z-Way callback types
  this.ZWAY_DEVICE_CHANGE_TYPES = {
    "DeviceAdded": 0x01,
    "DeviceRemoved": 0x02,
    "InstanceAdded": 0x04,
    "InstanceRemoved": 0x08,
    "CommandAdded": 0x10,
    "CommandRemoved": 0x20,
    "ZDDXSaved": 0x100,
    "EnumerateExisting": 0x200
  };
  this.ZWAY_DATA_CHANGE_TYPE = {
    "Updated": 0x01,           // Value updated or child created
    "Invalidated": 0x02,   // Value invalidated
    "Deleted": 0x03,           // Data holder deleted - callback is called last time before being deleted
    "ChildCreated": 0x04,  // New direct child node created

    // ORed flags
    "PhantomUpdate": 0x40, // Data holder updated with same value (only updateTime changed)
    "ChildEvent": 0x80   // Event from child node
  };

  // catch newly created z-way devices (to enumerate empty structures)
  this.zwayBinding = this.zway.bind(function(type, nodeId) {
    if (type === self.ZWAY_DEVICE_CHANGE_TYPES["DeviceAdded"] && nodeId != self.zway.controller.data.nodeId.value) {
      self.addDeviceEmptyParent.call(self, self.zwayName, nodeId);
    }
  }, this.ZWAY_DEVICE_CHANGE_TYPES["DeviceAdded"] | this.ZWAY_DEVICE_CHANGE_TYPES["EnumerateExisting"]);

  // Bind to all future CommandClasses changes to trap interviewDone event and explicitelly push device status
  // don't save the function for unbind - we never unbind
  this.zway.bind(function (type, nodeId, instanceId, commandClassId) {
    if (type === self.ZWAY_DEVICE_CHANGE_TYPES["CommandAdded"]) {
      // don't save the function for unbind - we never unbind
      self.zway.devices[nodeId].instances[instanceId].commandClasses[commandClassId].data.interviewDone.bind(function(type) {
        if (this.value === true && type !== self.ZWAY_DATA_CHANGE_TYPE["Deleted"]) {
          self.notify({
            action: "deviceUpdate",
            data: self.JSONifyDevice("ZWayVDev_" + self.zwayName + "_" + nodeId)
          });
        }
      });
    }
  }, this.ZWAY_DEVICE_CHANGE_TYPES["CommandAdded"] | this.ZWAY_DEVICE_CHANGE_TYPES["EnumerateExisting"]);

  // restore homeMode
  try {
    this.homeMode = loadObject("O7-homeMode");
  } catch (e) {
    this.warining("Unable to load homeMode, keeping undefined");
  }

  // restore rules from local storage
  this.rules = [];
  try {
    this.rules = loadObject("O7-rules");
    if (!Array.isArray(this.rules)) {
      this.rules = [];
    }
  } catch (e) {
    this.warining("Unable to load rules, using empty list");
  }
  
  // start timer for rules
  self.timerHandler = function() {
    self.rulesCheck({type: "atTime"});
    self.timer = setTimeout(self.timerHandler, (60 - (new Date()).getSeconds())*1000);
  };
  self.timerHandler();
}

// Helpers

O7.prototype.error = function() {
  var args = Array.prototype.slice.call(arguments);
  console.log("[O7] [Error]", args);
};

O7.prototype.warning = function() {
  var args = Array.prototype.slice.call(arguments);
  console.log("[O7] [Warning]", args);
};

O7.prototype.debug = function() {
  var args = Array.prototype.slice.call(arguments);
  console.log("[O7] [Debug]", args);
};

O7.prototype.notImplemented = function(name) {
  this.warning("Function \"" + name + "\" not implemented");
};

/*
 * Return auth token
 * @param reset - if true, re-generate new token
 */
O7.prototype.getToken = function(reset) {
  var token;
  if (!reset) {
    try {
      token = loadObject("O7-auth-token");
    } catch (e) {
    }
  }
  if (!token) {
    token = crypto.guid();
    saveObject("O7-auth-token", token, true);
    this.debug("New token generated");
  }
  return token;
};

O7.prototype.formatUUID = function(uuid) {
  if (!uuid || uuid.length !== 32) {
    this.error("UUID length is wrong: '" + uuid + "'");
    return "00000000-0000-0000-0000-000000000000";
  }
  return uuid.substr(0, 8) + "-" + uuid.substr(8, 4) + "-" + uuid.substr(12, 4) + "-" + uuid.substr(16, 4) + "-" + uuid.substr(20, 12);
};

O7.prototype.readMAC = function() {
  var zeroMAC = "00:00:00:00:00:00";
  try {
    var re = /^(([A-Fa-f0-9]{1,2}[:]){5}[A-Fa-f0-9]{1,2}[,]?)+$/,
        mac = fs.loadJSON("mac.json");
    if (re.test(mac)) {
      return mac;
    } else {
      return zeroMAC;
    }
  } catch (e) {
    return zeroMAC;
  }
};

O7.prototype.readOSVersion = function() {
  try {
    return fs.loadJSON("box-version-history.json");
  } catch (e) {
    return "0";
  }
};

O7.prototype.clientConnect = function() {
  var self = this;

  try {
    self.debug("Creating socket");
    this.client_sock = new sockets.websocket(this.O7_WS, null, this.O7_SSL_CA, this.O7_SSL_CERT, this.O7_SSL_KEY);
    this.client_sock.connected = false;
    self.debug("Created socket");
  } catch(e) {
    self.debug("Socket creation exception: " + e.toString());
    setTimeout(function() {
      self.debug("Reconnecting...");
      self.clientConnect();
    }, self.RECONNECT_PERIOD * 1000);
    return;
  }

  this.client_sock.onconnect = function() {
    self.debug("Connected to server");
    this.connected = true;
    try {
      self.LEDconnected(!this.connected);
    } catch (e) {
      self.error("Can not handle Connected LED: " + e)
    }
    
    // После установки соединения с ws-сервером, он начинает каждые 3 сек слать
    // heartbeat-сообщения {"type":"ping","message":текущий_timestamp}

    // Subscription for channel
    self.sendObjToSock(this, {}, "subscribe");

    self.ping(); // стартуем таймер переподключения
  };

  this.client_sock.onmessage = function(ev) {
    self.parseMessage(this, ev.data);
  };

  this.client_sock._onclose = function() {
    self.debug("Closing client socket");
    this.connected = false;
    try {
      self.LEDconnected(!this.connected);
    } catch (e) {
      self.error("Can not handle Connected LED: " + e)
    }
    this.onclose = null; // to prevent recursive call
    this.close(); // just in case (for explicit calls of this function)
    self.client_sock = null;
    self.data_fragments = ''; // clean saved fragments

    setTimeout(function() {
      if (self.client_sock === null) {
        self.debug("Reconnecting...");
        self.clientConnect();
      }
    }, self.RECONNECT_PERIOD * 1000);
  };
  this.client_sock.onclose = this.client_sock._onclose;

  this.client_sock.onerror = function(ev) {
    self.error("Socket error: " + ev.data);
    this._onclose(); // internally it will close the socket and restart everything again
  };
};

// Временный хак ддя переподключения
// Как только перестаём получать пинги, переподключаемся
O7.prototype.ping = function() {
  var self = this;

  if (this.ping_timer) {
    clearTimeout(this.ping_timer);
    this.ping_timer = null;
  }

  this.ping_timer = setTimeout(function() {
    this.ping_timer = null;
    if (!self.client_sock) return; // socket does not exist anymore
    self.error("No ping for a long time... reconnecting");
    self.client_sock._onclose();
  }, self.PING_TIMEOUT * 1000);
};

/**
 *
 * @param sock WS-object
 * @param message Client message
 */
O7.prototype.parseMessage = function(sock, data) {
  var self = this,
      obj;
  
  this.data_fragments += data;
  try {
    obj = JSON.parse(this.data_fragments);
    this.data_fragments = '';
  } catch (e) {
    this.debug("Fragment received: " + data);
    return;
  }

  var msg  = obj.message;

  if (obj.type === "ping") {
    this.ping();
    if (sock != null) { sock.send('{"type":"pong"}'); }
  }

  if (typeof msg !== "object") return;

  this.debug("Parsing: " + data);

  switch (msg.action) {
    case "getUidRequest":
      this.sendObjToSock(sock, {
        action: "getUidReply",
        data: this.O7_UUID
      });
      break;
    case "getVersionRequest":
      this.sendObjToSock(sock, {
        action: "getVersionReply",
        data: "v1"
      });
      break;
    case "getHomeModeRequest":
      this.sendObjToSock(sock, {
        action: "getHomeModeReply",
        data: { homeMode: this.getHomeMode() }
      });
      break;
      // Получение информации о контроллере
    case "getHomeInfoRequest":
      this.sendObjToSock(sock, {
        action: "getHomeInfoReply",
        data: {
          mac: this.O7_MAC,
          homeMode: this.getHomeMode(),
          vendor: "Z-Wave.Me",
          swVersion: this.swVersion,
          swCommit: this.swCommit,
          swDate: this.swDate,
          osVersion: this.O7_OS_VER,
          hwVersion: this.hwVersion
        }
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
      // O7 is ready for events, send buffered events
      this.sendBufferedEvents();
      break;
    case "getDeviceRequest":
      this.sendObjToSock(sock, {
        action: "getDeviceReply",
        data: this.JSONifyDevice(msg.id)
      });
      break;
    case "deviceAdd":
      this.deviceAdd();
      break;
    case "stopDeviceAdd":
      this.stopDeviceAdd();
      break;
    case "deviceRemove":
      this.deviceRemove(msg.id, msg.dead);
      break;
    case "stopDeviceRemove":
      this.stopDeviceRemove(msg.id);
      break;
    case "stopDeviceAddRemove":
      this.stopDeviceAdd();
      this.stopDeviceRemove();
      break;
    case "setRules":
      this.rulesSet(msg.data);
      this.sendObjToSock(sock, {
        action: "setRulesReply",
        data: {synced: true}
      });
      break;
    case "runRule":
      var rule = _.find(this.rules, function (rul) {
        return rul.id == msg.id;
      });

      //TODO: return/break if no rule
      try {
        if(!rule) {
          throw 'Сценарий не найден на контроллере';
        }

        this.ruleCheck(rule, {type: 'manual'}); // передаем ID сценария
      } catch (e) {
        this.sendObjToSock(sock, {
          action: "ruleReply",
          data: {id: rule.id, done: false, errors: [e.message]}
        });
      }
      break;
    case "getRules":
      this.sendObjToSock(sock, {
        action: "getRulesReply",
        data: this.rules
      });
      break;
    case "executeShell":
      var result = system(". /lib/O7Runner.sh && " + Base64.decode(msg.data));
      this.sendObjToSock(sock, {
        action: "executeShellReply",
        code: result[0] ? "Error" : "OK",
        data: Base64.encode(result[1])
      });
      break;
    case "executeJS":
      var _code, _data;
      try {
        var r = eval(Base64.decode(msg.data));
        if (typeof r === "function") {
          _data = "(function)";
        } else {
          _data = JSON.stringify(r);
        }
	_code = "OK";
      } catch (e) {
        _code = "Error";
        _data = JSON.stringify(e);
      }
      this.sendObjToSock(sock, {
        action: "executeJSReply",
        code: _code,
        data: Base64.encode(_data)
      });
      break;
    case "cameraEvent":
      self.rulesCheck({type: "cameraEvent", data: msg.data });
      break;
    case "getWiFiNetworks":
      self.getWiFiNetworks();
      break;
    case "setWiFiNetwork":
      self.setWiFiNetowrk(msg.data.essid, msg.data.security, msg.data.encryption, msg.data.password);
      break;
    case "getConnections": // TODO remove?
      self.getConnections();
      break;
    default:
      this.sendObjToSock(sock, {
        action: "commandNotFound",
        data: {"status": "failed", "id": null, "message": "Нет такой команды"}
      });
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
        zwayChannelId = parseInt(match[4]),
        o7dev = this.devices.get(id);

    var _dev = this.devices.add({
      id: id,
      zwayName: zwayName,
      zwayId: zwayId
    });

    _dev.add({
      id: vDev.id,
      zwayChannelId: zwayChannelId
    });

    vDev.on("change:metrics:level", function(vdev) {
      self.debug("Device changed: " + vdev.id);
      self.notifyDeviceChange(vdev.id);
    });
    
    vDev.on("change:metrics:isFailed", function(vdev) {
      self.debug("Device link status updated: " + vdev.id);
      self.notifyDeviceChange(vdev.id);
    });
  }
};

O7.prototype.addDeviceEmptyParent = function(zwayName, zwayId) {
  var _dev = this.devices.add({
    id: "ZWayVDev_" + zwayName + "_" + zwayId,
    zwayName: zwayName,
    zwayId: zwayId
  });
};

O7.prototype.getMasterDevice = function(id) {
  if (id.substr(0, "CtrlVDev".length) === "CtrlVDev") return "CtrlVDev"; // special case for controller
  
  var pattern = "(ZWayVDev_([^_]+)_([0-9]+))-([0-9]+)((-[0-9]+)*)",
      match = id.match(pattern);

  return match && match[1] || "";
};

/**
 * There might be few Z-Way objects. We select first one as main.
 */
O7.prototype.getMainZWay = function() {
  if (typeof zway === "object" && zway) {
    this.debug("Using default Z-Way '" + zway.name + "'");
    return {zway: zway, zwayName: zway.name};
  }
  var Z;
  if (typeof ZWave === "object" && (Z = Object.keys(ZWave)) && Z.length && ZWave[Z[0]])
  {
    this.debug("Using first found Z-Way '" + Z[0] + "'");
    return {zway: ZWave[Z[0]].zway, zwayName: Z[0]};
  }
  this.debug("No Z-Way found");
  return null;
};

/**
 *
 * @param sock WS-client instance
 * @param obj Data for sending
 */
O7.prototype.sendObjToSock = function(sock, obj, command) {
  command = typeof(command) == 'undefined' ? 'message' : command;

  var data = {
    identifier: "{\"channel\": \"ZwayChannel\", \"uuid\": \"" + this.O7_UUID  + "\"}",
    command: command,
    data: JSON.stringify(obj) // ВАЖНО: data - это json-строка, а не объект
  }, message = JSON.stringify(data);


  if (sock != null) {
    this.debug('Send: ' + message);
    sock.send(message);
  } else {
    this.error("No WS-connection for sending message: " + message);
  }

};

/**
 * Get buffered events to send to O7
 */
O7.prototype.getBufferedEvents = function() {
  var bufferedEvents = [];
  
  try {
    bufferedEvents = loadObject("O7-bufferend-events");
    if (!Array.isArray(bufferedEvents)) {
      bufferedEvents = [];
    }
  } catch (e) { }

  return bufferedEvents;
}

/**
 * Save event locally if O7 is unreachable
 * @param data
 */
O7.prototype.saveBufferedEvent = function(data) {
  var bufferedEvents = this.getBufferedEvents();
  
  bufferedEvents.push(data);
  bufferedEvents = bufferedEvents.slice(-this.O7_BUFFERED_EVENTS_LENGTH);
  saveObject("O7-bufferend-events", bufferedEvents, 10);
}

/**
 * Send buffered events to O7
 */
O7.prototype.sendBufferedEvents = function() {
  var self = this,
      bufferedEvents = this.getBufferedEvents();

  // clear buffered list
  saveObject("O7-bufferend-events", [], 10);
  
  bufferedEvents.forEach(function(event) {
    self.notifyO7(event);
  });
}

/**
 * Notify O7
 * @param data
 */
O7.prototype.notifyO7 = function(data) {
  try {
    if (this.client_sock && this.client_sock.connected) {
      this.sendObjToSock(this.client_sock, data);
    } else {
      this.saveBufferedEvent(data);
    }
  } catch(e) {
    this.error("Socket send error: " + e);
    this.saveBufferedEvent(data);
  }
};

/**
 * Notification O7 and clients
 * @param data
 */
O7.prototype.notify = function(data) {
  this.notifyO7(data);

  for (var i in this.server_clients) {
    try {
      this.sendObjToSock(this.server_clients[i], data);
    } catch(e) {
      this.error("Socket send error: " + e);
    }
  }
};

/**
 * Notification about device change state
 * @param id Device ID
 */
O7.prototype.notifyDeviceChange = function(id) {
  this.notify({
    action: "deviceUpdate",
    data: this.JSONifyDevice(this.getMasterDevice(id))
  });

  this.rulesCheck({type: "deviceState", deviceId: id});
};

/**
 * Notification about home mode change
 */
O7.prototype.notifyHomeModeChange = function() {
  this.notify({
    action: "homeModeUpdate",
    data: this.homeMode
  });
};

/**
 * Cloud actions
 * @param data
 */
O7.prototype.cloudAction = function(ruleId, action, args) {
  this.notify({
    action: 'cloud',
    data: {action: action, ruleId: ruleId, args: args}
  });
};

O7.prototype.cameraAction = function(ruleId, uuid, action, args) {
  this.notify({
    action: 'cameraAction',
    data: {ruleId: ruleId, uuid: uuid, action: action, args: args}
  });
};

O7.prototype.JSONifyDevice = function(id) {
  var dev = this.devices.get(id);

  if (dev) {
    return this.deviceToJSON(dev);
  }

  return null;
};

O7.prototype.deviceToJSON = function(dev) {
  if (dev && dev.id == "CtrlVDev") {
    return this.controllerDeviceToJSON();
  }

  if (!dev || !dev.id || !dev.zwayName || !dev.zwayId) {
    return this.error("Illegal arguments");
  }

  var zway = ZWave[dev.zwayName] && ZWave[dev.zwayName].zway,
      zDev = zway && zway.devices[dev.zwayId] || null,
      zData = zDev && zDev.data || null;

  if (zData == null) {
    return this.error("device structure exists, but zway device does not: " + dev.id + " (Z-Way ID " + dev.zwayName + "/" + dev.zwayId + ")");
  }

  var ccTotal = 0, ccDone = 0;
  for (var instanceId in zDev.instances) {
    for (var ccId in zDev.instances[instanceId].commandClasses) {
      if (zDev.instances[instanceId].commandClasses[ccId].data.supported.value) {
        ccTotal++;
        if (zDev.instances[instanceId].commandClasses[ccId].data.interviewDone.value) {
          ccDone++;
        }
      }
    }
  }

  var security = "";
  if (zData.secureChannelEstablished && zData.secureChannelEstablished.value && zDev.instances[0].Security && zDev.instances[0].Security.data) {
    switch (zDev.instances[0].Security.data.version.value) {
      case 1:
        security = "Security S0";
        break;
      case 2:
        security = "Security S2";
        break;
      default:
        security = "unknown";
    }
  }

  var ret = {
    id: dev.id,
    source: "z-wave",
    manufacturerId: zData.manufacturerId.value,
    productTypeId: zData.manufacturerProductType.value,
    productId: zData.manufacturerProductId.value,
    productName: zData.vendorString.value || "",
    appVersion: zData.applicationMajor.value.toString() + "." + ("00" + zData.applicationMinor.value.toString()).slice(-2),
    security: security,
    protocol: (zDev.instances[0].ZWavePlus) ? "Z-Wave" : "Z-Wave Plus",
    interview: ccTotal ? Math.floor(ccDone/ccTotal*100) : 0,
    isFailed: zData.isFailed.value, // vDev metric isFailed is listened, but for device JSON fields fill we use zway.devices[N].data.isFailed to simplify
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
      channel: subdev.zwayChannelId,
      deviceType: deviceType,
      probeType: probeType || "",
      scaleTitle: _vDev.get("metrics:scaleTitle"),
      level: _vDev.get("metrics:level"),
      updateTime: _vDev.get("updateTime")
    };

    if (deviceType === "switchMultilevel") {
      _subdev.min = 0;
      _subdev.max = 99;
    }
    if (probeType === "switchColor_rgb") {
      _subdev.max = 255;
      _subdev.color = _vDev.get("metrics:color");
    }
    if (deviceType === "thermostat") {
      _subdev.min = 8;
      if (_vDev.get("metrics:min")) {
        _subdev.min = _vDev.get("metrics:min");
      }
      _subdev.max = 30;
      if (_vDev.get("metrics:max")) {
        _subdev.max = _vDev.get("metrics:max");
      }
    }

    ret.elements.push(_subdev);
  });

  return ret;
};

O7.prototype.JSONifyDevices = function() {
  var self = this;

  return this.devices.devices.map(function(_d) {
    return self.deviceToJSON(_d);
  }).filter(function(x) {
    return !!x; // remove null not to fill empty items into array
  });
};

O7.prototype.deviceAdd = function() {
  var self = this;

  this.debug("Adding new device");

  if (this.zway) {
    var zway = this.zway;

    if (zway.controller.data.controllerState.value != 0) {
      self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Контроллер занят", "error": "ADD_DEVICE_CONTROLLER_BUSY"}});
      return;
    }

    var started = false;

    var stop = function() {
      zway.controller.data.controllerState.unbind(ctrlStateUpdater);
    };
    this.deviceAddHelperUnbind = stop; // this is a dirty hack to make it visible to deviceAddStop

    var ctrlStateUpdater = function() {
      if (this.value === 1 || this.value === 5) { // AddReady or RemoveReady
        if (!started) {
          // first is NWI
          self.notify({"action": "deviceAddUpdate", "data": {"status": "started", "id": null}});
          started = true;
        } else {
          // RemoveNodeFromNetwork and second AddNodeToNetwork require button press
          self.notify({"action": "deviceAddUpdate", "data": {"status": "userInteractionRequired", "id": null}});
        }
      }
    };

    zway.controller.data.controllerState.bind(ctrlStateUpdater);

    var doRemoveAddProcess = function() {
      try {
        // try to exclude to then include
        zway.RemoveNodeFromNetwork(true, true, function() {
          setTimeout(function() { // relax time for Sigma state machine
            // excluded, now try to include again
            try {
              zway.AddNodeToNetwork(true, true, function() {
                if (zway.controller.data.lastIncludedDevice.value) {
                  self.notify({"action": "deviceAddUpdate", "data": {"status": "success", "id": "ZWayVDev_" + self.zwayName + "_" + zway.controller.data.lastIncludedDevice.value.toString(10)}});
                  stop();
                } else {
                  self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось включить", "error": "ADD_DEVICE_INCLUSION_FAILURE"}});
                  stop();
                }
              }, function() {
                self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось включить устройство", "error": "ADD_DEVICE_INCLUSION_FAILURE"}});
                stop();
              });
            } catch (e) {
              self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось начать процесс включения", "error": "ADD_DEVICE_UNEXPECTED_FAILURE"}});
              stop();
            }
          }, 500);
        }, function() {
          self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось сбросить устройство перед включением", "error": "ADD_DEVICE_EXCLUSION_FAILURE"}});
          stop();
        });
      } catch (e) {
        self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось начать сброс устройства перед включением", "error": "ADD_DEVICE_UNEXPECTED_FAILURE"}});
        stop();
      }
    };

    // first try NWI for 30 seconds
    var timerNWI = setTimeout(function() {
      // looks like device not in NWI mode
      // cancel inclusion
      timerNWI = null;
      if (zway.controller.data.controllerState.value !== 1) {
        return; // this means inclusion has already started, so don't stop it
      }
      try {
        zway.AddNodeToNetwork(false, false, function() {
          setTimeout(doRemoveAddProcess, 500); // relax time for Sigma state machine
        }, function() {
          self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось остановить включение NWI", "error": "ADD_DEVICE_UNEXPECTED_FAILURE"}});
          stop();
        });
      } catch (e) {
        self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось запустить остановку включения NWI", "error": "ADD_DEVICE_UNEXPECTED_FAILURE"}});
        stop();
      }
    }, 30*1000);

    try {
      zway.AddNodeToNetwork(true, true, function() {
        timerNWI = clearTimeout(timerNWI);
        if (zway.controller.data.lastIncludedDevice.value) {
          self.notify({"action": "deviceAddUpdate", "data": {"status": "success", "id": "ZWayVDev_" + self.zwayName + "_" + zway.controller.data.lastIncludedDevice.value.toString(10)}});
          stop();
        } else {
          // process failed - device was not included. Try Remove - Add process
          setTimeout(doRemoveAddProcess, 500); // relax time for Sigma state machine
        }
      }, function() {
        timerNWI = clearTimeout(timerNWI);
        self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось включить в NWI", "error": "ADD_DEVICE_UNEXPECTED_FAILURE"}});
        stop();
      });
    } catch (e) {
      timerNWI = clearTimeout(timerNWI);
      self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Что-то пошло не так", "error": "ADD_DEVICE_UNEXPECTED_FAILURE"}});
      stop();
    }
  } else {
    self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Что-то пошло не так (не нашёл zway)", "error": "ADD_DEVICE_UNEXPECTED_FAILURE"}});
  }
};

O7.prototype.stopDeviceAdd  = function () {
  var self = this;
  this.debug("Stop device add");

  if (this.zway) {
    // Inclusion mode
    if (zway.controller.data.controllerState.value === 1) {
      zway.controller.AddNodeToNetwork(0);
      self.deviceAddHelperUnbind && self.deviceAddHelperUnbind();
      self.notify({"action": "deviceAddUpdate", "data": {"status": "success", "id": null}});
    } else if (zway.controller.data.controllerState.value === 5) {
      zway.controller.RemoveNodeFromNetwork(0);
      self.deviceAddHelperUnbind && self.deviceAddHelperUnbind();
      self.notify({"action": "deviceAddUpdate", "data": {"status": "success", "id": null}});
    } else if (zway.controller.data.controllerState.value !== 0) {
      self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Контроллер занят, скоро закончит текущую операци включения/исключения и пришлёт результат добавления устройства в сеть (ничего не делаю)", "error": "ADD_DEVICE_STOP_COMMAND_IGNORED"}});
    } else {
      self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Контроллер не в режиме включения (ничего не делаю)", "error": "ADD_DEVICE_STOP_COMMAND_IGNORED"}});
    }
  } else {
    self.deviceAddHelperUnbind && self.deviceAddHelperUnbind();
    self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Что-то пошло не так (не нашёл устройство или zway)", "error": "ADD_DEVICE_STOP_UNEXPECTED_FAILURE"}});
  }
};

O7.prototype.deviceRemove = function(dev, dead) {
  var self = this,
      o7Dev = this.devices.get(dev);

  if (!o7Dev) {
    this.debug("Device " + dev + " not found");
    self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Устройство не найдено", "error": "REMOVE_DEVICE_NOT_FOUND"}});
    return;
  }

  this.debug("Removing " + dev);
  if (ZWave && ZWave[o7Dev.zwayName] && ZWave[o7Dev.zwayName].zway && ZWave[o7Dev.zwayName].zway.devices[o7Dev.zwayId]) {
    var zway = ZWave[o7Dev.zwayName].zway,
        zDev = zway.devices[o7Dev.zwayId];

    if (zway.controller.data.controllerState.value != 0) {
      self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Контроллер занят", "error": "REMOVE_DEVICE_CONTROLLER_BUSY"}});
      return;
    }

   function beginDeviceRemove() {
      if (zDev.data.isFailed.value) {
        // device is a failed one, we can remove it without user interaction
        try {
          zway.RemoveFailedNode(o7Dev.zwayId, function() {
            if (zway.controller.data.lastExcludedDevice.value == o7Dev.zwayId) { // non-strict == to allow compare strings with numbers
              self.notify({"action": "deviceRemoveUpdate", "data": {"status": "success", "id": dev}});
            } else {
              self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Что-то пошло не так (внутренняя ошибка исключения)", "error": "REMOVE_DEVICE_UNEXPECTED_ERROR"}});
            }
          }, function() {
            self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Не удалось исключить недоступное устройство", "error": "REMOVE_DEVICE_UNEXPECTED_FAILURE"}});
          });
          self.notify({"action": "deviceRemoveUpdate", "data": {"status": "started", "id": dev}});
        } catch (e) {
          self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Не удалось начать процесс исключения недоступного устройства", "error": "REMOVE_DEVICE_UNEXPECTED_FAILURE"}});
        }
      } else {
        var ctrlStateUpdater = function() {
          if (this.value === 5) { // RemoveReady
            self.notify({"action": "deviceRemoveUpdate", "data": {"status": "started", "id": dev}});
            self.notify({"action": "deviceRemoveUpdate", "data": {"status": "userInteractionRequired", "id": dev}});
          }
          zway.controller.data.controllerState.unbind(ctrlStateUpdater);
        };

        // device is not failed, user need to press a button
        try {
          zway.RemoveNodeFromNetwork(true, true, function() {
            if (zway.controller.data.lastExcludedDevice.value == o7Dev.zwayId) { // non-strict == to allow compare strings with numbers
              self.notify({"action": "deviceRemoveUpdate", "data": {"status": "success", "id": dev}});
            } else if (zway.controller.data.lastExcludedDevice.value != 0) {
              self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Исключено другое устройство", "error": "REMOVE_DEVICE_WRONG_NODE_EXCLUDED"}});
            } else {
              self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Сброшено к заводским настройкам устройство не из сети", "error": "REMOVE_DEVICE_FOREIGN_NODE_EXCLUDED"}});
            }
          }, function() {
            self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Не удалось исключить устройство", "error": "REMOVE_DEVICE_UNEXPECTED_FAILURE"}});
          });
          zway.controller.data.controllerState.bind(ctrlStateUpdater);
        } catch (e) {
          self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Не удалось начать процесс исключения устройства", "error": "REMOVE_DEVICE_UNEXPECTED_FAILURE"}});
        }
      }
    }
    if (dead && !zDev.data.isFailed.value) {
      // try
      zway.devices[o7Dev.zwayId].SendNoOperation(function () {
        if (zway.devices[o7Dev.zwayId].data.isFailed.value) {
          beginDeviceRemove();
        } else {
          self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Устройство не сломано, удалите его путём нажатия на кнопку.", "error": "REMOVE_DEVICE_DEAD_REACHABLE"}});
        }
      }, function() {
        self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Что-то пошло не так (не смог проверить доступность устройства)", "error": "REMOVE_DEVICE_UNEXPECTED_FAILURE"}});
      });
    } else {
      beginDeviceRemove();
    }

   } else {
    self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Что-то пошло не так (не нашёл устройство или zway)", "error": "REMOVE_DEVICE_UNEXPECTED_FAILURE"}});
  }
};

O7.prototype.stopDeviceRemove  = function (dev) {
  var self = this,
      o7Dev;

  if (dev) {
    o7Dev = this.devices.get(dev);
    if (!o7Dev) {
      this.debug("Device " + dev + " not found");
      self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Устройство не найдено", "error": "REMOVE_DEVICE_DEVICE_NOT_FOUND"}});
      return;
    }
  }

  this.debug("Stop device remove");

  var zway;
  if (o7Dev && ZWave && ZWave[o7Dev.zwayName] && ZWave[o7Dev.zwayName].zway && ZWave[o7Dev.zwayName].zway.devices[o7Dev.zwayId]) {
    zway = ZWave[o7Dev.zwayName].zway;
  } else {
    zwayObj = this.getMainZWay();
    if (zwayObj) {
      zway = zwayObj.zway;
    }
  }

  if (zway) {
    // Exclusion mode
    if (zway.controller.data.controllerState.value === 5) {
      zway.controller.RemoveNodeFromNetwork(0);
      self.notify({"action": "deviceRemoveUpdate", "data": {"status": "success", "id": null}});
    } else {
      self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": null, "message": "Контроллер не в режиме исключения (ничего не делаю)", "error": "REMOVE_DEVICE_STOP_COMMAND_IGNORED"}});
    }
  } else {
    self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Что-то пошло не так (не нашёл устройство или zway)", "error": "REMOVE_DEVICE_STOP_UNEXPECTED_FAILURE"}});
  }
};

// Rules engine

/*
 * Check rules on events
 * @param event событие формата { type: "atTime"|"deviceChange"|"homeMode", deviceId: (для deviceChange), mode: (для homeMode)}
 */
O7.prototype.rulesCheck = function(event) {
  var self = this;

  if(typeof(this.rules) == 'undefined') {
    return;
  }

  this.rules.forEach(function(rule) {
    self.ruleCheck(rule, event);
  });
};

O7.prototype.ruleCheck = function(rule, event) {

  var _condition, self = this;

  if (rule.state != "enabled") {
    return; // skip
  }

  // rule matches event type
  _condition = _.findWhere(rule.conditions, {type: event.type});
  if (typeof(_condition) == 'undefined') {
    return; // skip
  }

  if (event.type === "atTime") {
    _condition = _.findWhere(rule.conditions, {type: "atTime"});

    if (typeof(_condition) == 'undefined') {
      return; // skip
    }
  }

  if (event.type === "deviceState") {
    _condition = _.findWhere(rule.conditions, {type: "deviceState", deviceId: event.deviceId});
    if (typeof(_condition) == 'undefined') {
      return; // skip
    }
  }

  if (event.type === "homeMode") {
    _condition = _.findWhere(rule.conditions, {type: "homeMode"});
    if (typeof(_condition) == 'undefined') {
      return; // skip
    }
  }

  if (event.type === "cameraEvent") {
    _condition = _.findWhere(rule.conditions, {type: "cameraEvent", uuid: event.data.uuid});
    if (typeof(_condition) == 'undefined') {
      return; // skip
    }
  }

  // for event.type === "manual" there is nothing to check

  // rule matches, check condition

  var result = true;
  rule.conditions.forEach(function(condition) {
    switch (condition.type) {
      case "deviceState":
        var _dev = controller.devices.get(condition.deviceId);
        var _val;
        if (!_dev) {
          // search in CtrlVDev
          var _dev = self.controllerDeviceToJSON().elements.filter(function (e) { return e.id === condition.deviceId })[0];
          if (_dev) {
            _val = _dev.level;
          } else {
            result = false;
            return false;
          }
        } else {
          _val = _dev.get("metrics:level");
        }
        
        if (condition.comparison === "eq") {
          result = result && (_val === condition.level);
        }
        if (condition.comparison === "ne") {
          result = result && (_val !== condition.level);
        }
        if (condition.comparison === "ge") {
          result = result && (_val >= condition.level);
        }
        if (condition.comparison === "le") {
          result = result && (_val <= condition.level);
        }
        break;

      case "homeMode":
        if (condition.comparison === "eq") {
          result &= self.homeMode == condition.mode;
        }

        break;

      case "atTime":
        var _date = new Date();
        var _offset = rule.utc_offset || 0;

        _date.setSeconds(_offset);

        result &= condition.hour == _date.getHours();
        result &= condition.minute == _date.getMinutes();
        result &= condition.weekdays.indexOf(_date.getDay()) >= 0;

        break;
      case "cameraEvent":
          result &= event.type === "cameraEvent";
          if (result) {
            result &= condition.uuid == event.data.uuid;
            result &= condition.value == event.data.value;
          }
        break;
    }
  });

  if (!result) {
    return; // skip
  }

  // rule matched

  if (!self.rulesCounter[rule.id]) self.rulesCounter[rule.id] = 0;
  self.rulesCounter[rule.id]++;
  if (self.rulesCounter[rule.id] > self.RULES_MAX_PER_SECOND) {
    self.notifyO7({
      action: "ruleReply",
      data: {id: rule.id, done: false, errors: ['Превышено допустимое количество запуска сценария'], lastRulesExecuted: Object.keys(self.rulesCounter)}
    });
    return;
  }

  try {
    rule.actions.forEach(function (action) {
      switch (action.type) {
        case "deviceState":
          var _dev = controller.devices.get(action.deviceId);

          if (_dev) {
            _dev.performCommand(action.command, action.args);
          } else {
            // Don't check CtrlVDev because it has no actions (may be in future)
            self.error("device not found");
          }
          break;

        case "homeMode":
          self.setHomeMode(action.mode);
          break;

        case "cloud":
          self.cloudAction(rule.id, action.action, action.args);

          break;
        case "cameraEvent":
          self.cameraAction(rule.id, action.uuid, action.id, action);

          break;
      }
    });

    self.notifyO7({
      action: "ruleReply",
      data: {id: rule.id, done: true}
    });

  } catch(e) {
    self.notifyO7({
      action: "ruleReply",
      data: {id: rule.id, done: false, errors: ['Ошибка сценария']}
    });
  }
};

/*
 * Save new rules
 * @param rules массив JSON-объектов с описанием правил
 */
O7.prototype.rulesSet = function(rules) {
  // мы не делаем валидации здесь. возможно это нужно будет добавить
  
  // поправим некоторые типы данных
  for (var i in rules) {
    for (var j in rules[i].conditions) {
      if (rules[i].conditions[j].type === "atTime") {
        var time = rules[i].conditions[j].time.split(':');
        rules[i].conditions[j].hour = parseInt(time[0], 10);
        rules[i].conditions[j].minute = parseInt(time[1], 10);
        rules[i].conditions[j].weekdays = rules[i].conditions[j].weekdays.map(function(element) { return parseInt(element, 10); });
      }
    }
  }

  this.rules = rules;
  saveObject("O7-rules", rules, true);
};

O7.prototype.rulesGet = function(rules) {
  return this.rules;
};

// returns the list of Wi-Fi networks nearby as a structure of { channel: integer, essid: string, security: string(WPA2PSK|WPA1PSK|NONE), encryption: string(AES|TKIP), signal: integer }
O7.prototype.getWiFiNetworks = function() {
  var list = system(". /lib/O7Runner.sh && /lib/wifi-helper.sh LIST")[1].split("\n");
  list.pop(); list.pop(); list.shift(); list.shift(); // remove header and footer
  
  //        sprintf(msg+strlen(msg),"%-4s%-33s%-20s%-23s%-9s%-7s%-7s%-3s\n",
  //            "Ch", "SSID", "BSSID", "Security", "Siganl(%)", "W-Mode", " ExtCH"," NT");
  //        sprintf(msg+strlen(msg)-1,"%-4s%-5s\n", " WPS", " DPID");
  return list.map(function(l) { var m = l.match(/(.{4})(.{33})(.{20})(.{23})(.{9})(.{7})/); var sec = m[4].trim().split("/"); return { channel: parseInt(m[1]), essid: m[2].trim(), security: sec[0], encryption: sec[1], signal: parseInt(m[5])}; });
  // TODO!!! Parse WPA1PSKWPA2PSK and TKIPAES
};

O7.prototype.setWiFiNetwork = function(essid, security, encryption, password) {
  system('. /lib/O7Runner.sh && /lib/wifi-helper.sh "' + essid + '" "' + security + '" "' + encryption + '" "' + password + '"')
};

O7.prototype.getConnections = function() {
  var currentConnection = system(". /lib/O7Runner.sh && route | grep default | awk '$5 == 0 { if ($8 == \"eth0.1\") print \"ethernet\"; else if ($8 == \"apcli0\") print \"wifi\"; else if ($8 == \"eth1\") print \"mobile\"; else print $8 }'")[1].trim();
  var availableConnections = system(". /lib/O7Runner.sh && route | grep default | awk '$5 != 0 { if ($8 == \"eth0.1\") print \"ethernet\"; else if ($8 == \"apcli0\") print \"wifi\"; else if ($8 == \"eth1\") print \"mobile\"; else print $8 }'")[1].split("\n").filter(function(x) { return x != "" });
  var possibleConnections = [ "ethernet", "wifi", "mobile" ]; // possible values
  
  return { currentConnection: currentConnection, availableConnections: availableConnections, possibleConnections: possibleConnections };
};

// isFailed - новое

O7.prototype.controllerDeviceToJSON = function() {
  var self = this;
  var ctrlName = "CtrlVDev";
  var ctrlObject = {
    "id": ctrlName,
    "source": "controller",
    "manufacturerId": 277, // Z-Wave.Me
    "productTypeId": 4096,
    "productId": 1,
    "productName": "Z-Wave.Me Hub",
    "appVersion": "2.3",
    "security": "Security",
    "protocol": "GPIO",
    "interview": 100,
    "isFailed": false,
    "elements": []
  };
  
  var _vDevTamper = controller.devices.filter(function(d) { return d.id.match(/PhilioHW_[0-9]+_zway_Tamper/); });
  var _vDevPowerFailure = controller.devices.filter(function(d) { return d.id.match(/PhilioHW_[0-9]+_zway_PowerFailure/); });
  var _vDevBatteryLevel = controller.devices.filter(function(d) { return d.id.match(/PhilioHW_[0-9]+_zway_BatteryLevel/); });
  
  if (_vDevBatteryLevel && _vDevBatteryLevel[0]) {
    var elementId = ctrlName + "-0-128";
    ctrlObject.elements.push({
      "id": elementId,
      "deviceType": "sensorMultilevel",
      "probeType": "battery",
      "scaleTitle": "%",
      "level": _vDevBatteryLevel[0].get("metrics:level"),
      "updateTime": _vDevBatteryLevel[0].get("updateTime")
    });
    if (!this.controllerHandlers)
    _vDevBatteryLevel[0].on("change:metrics:level", function(vdev) {
      self.debug("Device changed: " + elementId);
      self.notifyDeviceChange(elementId);
      self.rulesCheck({type: "deviceState", deviceId: elementId});
    });
  }
  if (_vDevTamper && _vDevTamper[0]) {
    var elementId = ctrlName + "-0-113-7-3";
    ctrlObject.elements.push({
      "id": elementId,
      "deviceType": "sensorBinary",
      "probeType": "tamper",
      "scaleTitle": "",
      "level": _vDevTamper[0].get("metrics:level"),
      "updateTime": _vDevTamper[0].get("updateTime")
    });
    if (!this.controllerHandlers)
    _vDevTamper[0].on("change:metrics:level", function(vdev) {
      self.debug("Device changed: " + elementId);
      self.notifyDeviceChange(elementId);
      self.rulesCheck({type: "deviceState", deviceId: elementId});
    });
  }
  if (_vDevPowerFailure && _vDevPowerFailure[0]) {
    var elementId = ctrlName + "-0-113-8-2";
    ctrlObject.elements.push({
      "id": elementId,
      "deviceType": "sensorBinary",
      "probeType": "powerFailure",
      "scaleTitle": "",
      "level": _vDevPowerFailure[0].get("metrics:level"),
      "updateTime": _vDevPowerFailure[0].get("updateTime")
    });
    if (!this.controllerHandlers)
    _vDevPowerFailure[0].on("change:metrics:level", function(vdev) {
      self.debug("Device changed: " + elementId);
      self.notifyDeviceChange(elementId);
      self.rulesCheck({type: "deviceState", deviceId: elementId});
    });
  }
  
  if (_vDevTamper && _vDevTamper[0]) { // for now only Philio HW have WiFi and 3G
    var net = this.getConnections();
    var d = Math.floor((new Date()).getTime()/1000);
 
    var elementIdCurrent = ctrlName + "-network-current";
    var elementIdAvailable = ctrlName + "-network-available";
    
    var currentConnectionElement = {
      "id": elementIdCurrent,
      "deviceType": "sensorDiscrete",
      "probeType": "connectionType",
      "scaleTitle": "",
      "level": net.currentConnection,
      "possibleLevels": net.possibleConnections,
      "updateTime": self.controllerCurrentConnectionUpdateTime ? self.controllerCurrentConnectionUpdateTime : d
    };
    
    var availableConnectionsElement = {
      "id": elementIdAvailable,
      "deviceType": "list",
      "probeType": "connectionTypes",
      "scaleTitle": "",
      "list": net.availableConnections,
      "possibleLevels": net.possibleConnections,
      "updateTime": self.controllerAvailableConnectionsUpdateTime ? self.controllerAvailableConnectionsUpdateTime : d
    };
  
    ctrlObject.elements.push(currentConnectionElement);
    ctrlObject.elements.push(availableConnectionsElement);
    
    // poll current connection
    if (!this.controllerHandlers)
    this.currentConnectionTimer = setInterval(function() {
      var net = self.getConnections();
      var d = Math.floor((new Date()).getTime()/1000);
      
      if (self.controllerCurrentConnection != net.currentConnection) {
        self.controllerCurrentConnection = net.currentConnection;
        self.controllerCurrentConnectionUpdateTime = d;
        
        currentConnectionElement.level = self.controllerCurrentConnection;
        currentConnectionElement.updateTime = self.controllerCurrentConnectionUpdateTime;
        
        self.debug("Device changed: " + elementIdCurrent);
        self.notifyDeviceChange(elementIdCurrent);
        self.rulesCheck({type: "deviceState", deviceId: elementIdCurrent});
      }
      if (!_.isEqual(self.controllerAvailableConnections, net.availableConnections)) {
        self.controllerAvailableConnections = net.availableConnections;
        self.controllerAvailableConnectionsUpdateTime = d;
        
        availableConnectionsElement.level = self.controllerAvailableConnections;
        availableConnectionsElement.updateTime = self.controllerAvailableConnectionsUpdateTime;
        
        self.debug("Device changed: " + elementIdAvailable);
        self.notifyDeviceChange(elementIdAvailable);
        self.rulesCheck({type: "deviceState", deviceId: elementIdAvailable});
      }
    }, 15*1000);
  }
  
  // handlers attached
  this.controllerHandlers = true;
  
  return ctrlObject;
};
 
// Subdevice object

O7SubDevice = function (prop) {
  this.id = prop && prop.id || 0;
  this.zwayChannelId = prop && prop.zwayChannelId || 0;
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
  return this.homeMode;
};

O7.prototype.setHomeMode = function(mode) {
  this.homeMode = mode;
  this.rulesCheck({type: "homeMode", mode: mode});
  this.notifyHomeModeChange();
  saveObject("O7-homeMode", this.homeMode, true);
};

var o7 = new O7();

