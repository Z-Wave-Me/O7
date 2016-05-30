/*

 > {"command": "getVersionRequest"}
 < {"command": "getVersionReply", "data": "v1"}

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

  // Save Z-Way context for future use
  var zwayObj = this.getMainZWay();
  if (zwayObj === null) {
    return;
  }
  this.zway = zwayObj.zway;
  this.zwayName = zwayObj.zwayName;

  if (!sockets.websocket) {
    this.error("Websockets are not supported. Stopping.");
    return;
  }
  
  this.O7_UUID = this.formatUUID(this.zway.controller.data.uuid.value);
  // this.O7_UUID = "058943ba-97b0-4b6c-3f85-e130592feaeb"; // для отладки на старый стиках/RaZberry или для жётской привязки к UUID
  this.O7_MAC = this.readMAC();
  this.O7_PROTOCOL = "ws";
  this.O7_HOST     = "smart.local";
  this.O7_PORT     = 4080;
  this.O7_TOKEN = this.getToken();
  this.O7_PATH     = "/?uuid=" + this.O7_UUID + "&token=" + this.O7_TOKEN + "&source=controller";
  this.O7_WS = this.O7_PROTOCOL + "://" + this.O7_HOST + (this.O7_PORT.toString().length > 0 ? ":" + this.O7_PORT : "") + this.O7_PATH;

  this.RECONNECT_PERIOD = 7;

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
  this.server_sock.onerror = function() {
    self.debug("Client error");
  };
  this.server_sock.onmessage = function(ev) {
    self.parseMessage(this, ev.data);
  };

  // start UDP broadcast UUID discovery service
  this.server_discovery = new sockets.udp();
  this.server_discovery.reusable();
  this.server_discovery.bind("255.255.255.255", 4444);
  this.server_discovery.onrecv = function(data, host, port) {
    this.sendto('{"uuid": "' + self.O7_UUID + '", "mac": "' + self.O7_MAC + '"}', host, port);
  };
  this.server_discovery.listen();

  // connect to O7
  this.clientConnect();

  // create vDev <=> O7 Dev bindings
  this.devices = new O7Devices();

  // catch newly created devices
  controller.devices.on('created', function(vDev) {
    self.addDevice.call(self, vDev);
  });

  // enumerate existing devices
  controller.devices.forEach(function(vDev) {
    self.addDevice.call(self, vDev);
  });
  
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
  console.log("Warining:", "Function \"" + name + "\" not implemented");
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
    saveObject("O7-auth-token", token);
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

O7.prototype.clientConnect = function() {
  var self = this;

  this.client_sock = new sockets.websocket(this.O7_WS);

  this.client_sock.onconnect = function() {
    // После установки соединения с ws-сервером, он начинает каждые 3 сек слать
    // heartbeat-сообщения {"identifier":"_ping","message":текущий_timestamp}

    // Subscription for channel
    self.sendObjToSock(this, {}, "subscribe");
  };

  this.client_sock.onmessage = function(ev) {
    self.parseMessage(this, ev.data);
  };


  this.client_sock.onclose = function() {
    self.debug("Closing client socket");
    this.close();
    self.client_sock = null;

    setTimeout(function() {
      if (self.client_sock === null) {
        self.debug("Reconnecting...");
        self.clientConnect();
      }
    }, self.RECONNECT_PERIOD * 1000);
  };

  this.client_sock.onerror = function(ev) {
    self.error("Willing to close client socket: " + ev.data);
    this.close();
    self.client_sock = null;
  };
};


/**
 *
 * @param sock WS-object
 * @param message Client message
 */
O7.prototype.parseMessage = function(sock, data) {
  var self = this,
      obj  = JSON.parse(data),
      msg  = obj.message;

  if (typeof msg !== "object") return;

  this.debug("Parsing: " + data);

  switch (msg.action) {
    case "getUidRequest":
      this.sendObjToSock(sock, {
        action: "getUidReply",
        data: this.O7_UUID
      });
      break;
    case "getControllerInfoRequest":
      this.sendObjToSock(sock, {
        action: "getControllerInfoReply",
        data: {mac: this.readMAC()}
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
        data: {mac: this.readMAC(), homeMode: this.getHomeMode()}
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
      this.deviceRemove(msg.id);
      break;
    case "stopDeviceRemove":
      this.stopDeviceRemove(msg.id);
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

        this.checkRuleItem(rule, {type: 'manual'}); // передаем ID сценария

        this.sendObjToSock(sock, {
          action: "runRuleReply",
          data: {id: rule.id, done: true}
        });
      } catch (e) {
        this.sendObjToSock(sock, {
          action: "runRuleReply",
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
      self.rulesCheck({type: "deviceChange", deviceId: vdev.id});
    });
  }
};

O7.prototype.getMasterDevice = function(id) {
  var pattern = "(ZWayVDev_([^_]+)_([0-9]+))-([0-9]+)((-[0-9]+)*)",
      match = id.match(pattern);

  return match && match[1] || "";
};

/**
 * There might be few Z-Way objects. We select first one as main.
 */
O7.prototype.getMainZWay = function() {
  var self = this;
  if (typeof zway === "object" && zway) {
    this.debug("Using default Z-Way 'zway'");
    zway.controller.data.controllerState.bind(function(){
      self.notify({"action": "deviceAddUpdate", "data": {"status": this.value, "id": null}})
    });
    return {zway: zway, zwayName: "zway"};
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
    identifier: "{\"channel\": \"ZwayChannel\", \"uuid\": \"" + this.O7_UUID + "\", \"mac\": \"" + this.O7_MAC + "\"}",
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
 * Notify O7
 * @param data
 */
O7.prototype.notifyO7 = function(data) {
  try {
    this.client_sock && this.sendObjToSock(this.client_sock, data);
  } catch(e) {
    this.error("Socket send error: " + e);
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
O7.prototype.cloudAction = function(action, args) {
  this.notify({
    action: action,
    data: args
  });
};

O7.prototype.JSONifyDevice = function(id) {
  var dev = this.devices.get(id);

  this.debug(JSON.stringify(dev));
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
    productName: zData.vendorString.value || "",
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

    ret.elements.push(_subdev);
  });

  return ret;
};

O7.prototype.JSONifyDevices = function() {
  var self = this;
  
  return this.devices.devices.map(function(_d) {
    return self.deviceToJSON(_d);
  });
};

O7.prototype.deviceAdd = function() {
  var self = this;
  
  this.debug("Adding new device");
  
  if (this.zway) {
    var zway = this.zway;
    
    if (zway.controller.data.controllerState.value != 0) {
      self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Занят"}});
    }
    
    var started = false;
    
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
    
    var stop = function() {
      zway.controller.data.controllerState.unbind(ctrlStateUpdater);
    };
    
    zway.controller.data.controllerState.bind(ctrlStateUpdater);

    var doRemoveAddProcess = function() {
      try {
        // try to exclude to then include
        zway.RemoveNodeFromNetwork(true, true, function() {
          setTimeout(function() { // relax time for Sigma state machine
            // excluded, now try to include again
            zway.AddNodeToNetwork(true, true, function() {
              if (zway.controller.data.lastIncludedDevice.value) {
                self.notify({"action": "deviceAddUpdate", "data": {"status": "success", "id": "ZWayVDev_" + self.zwayName + "_" + zway.controller.data.lastIncludedDevice.value.toString(10)}});
                stop();
              } else {
                self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось включить"}});
                stop();
              }
            }, function() {
              self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось включить"}});
              stop();
            });
          }, 500);
        }, function() {
          self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось исключить"}});
          stop();
        });
      } catch (e) {
        self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось запустить остановку включения NWI"}});
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
          self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось остановить включить NWI"}});
          stop();
        });
      } catch (e) {
        self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось запустить остановку включения NWI"}});
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
        self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Не удалось включить в NWI"}});
        stop();
      });
    } catch (e) {
      timerNWI = clearTimeout(timerNWI);
      self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": dev, "message": "Что-то пошло не так"}});
      stop();
    }
  } else {
    self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Что-то пошло не так (не нашёл zway)"}});
  }
};

O7.prototype.stopDeviceAdd  = function () {
  var self = this;
  this.debug("Stop device add");

  if (this.zway) {
    // Inclusion mode
    if (zway.controller.data.controllerState.value == 1) {
      zway.controller.AddNodeToNetwork(0);
      self.notify({"action": "deviceAddUpdate", "data": {"status": "success", "id": null}});
    } else {
      self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": null, "message": "Контроллер не в режиме включения"}});
    }
  } else {
    self.notify({"action": "deviceAddUpdate", "data": {"status": "failed", "id": dev, "message": "Что-то пошло не так (не нашёл устройство или zway)"}});
  }
};

O7.prototype.deviceRemove = function(dev) {
  var self = this,
      o7Dev = this.devices.get(dev);
  
  if (!o7Dev) {
    this.debug("Device " + dev + " not found");
    self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Устройство не найдено"}});
  }

  this.debug("Removing " + dev);
  if (ZWave && ZWave[o7Dev.zwayName] && ZWave[o7Dev.zwayName].zway && ZWave[o7Dev.zwayName].zway.devices[o7Dev.zwayId]) {
    var zway = ZWave[o7Dev.zwayName].zway,
        zDev = zway.devices[o7Dev.zwayId];

    if (zway.controller.data.controllerState.value != 0) {
      self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Занят"}});
    }

    if (zDev.data.isFailed.value) {
      // device is a failed one, we can remove it without user interaction
      try {
        zway.RemoveFailedNode(o7Dev.zwayId, function() {
          if (zway.controller.data.lastExcludedDevice.value == o7Dev.zwayId) { // non-strict == to allow compare strings with numbers
            self.notify({"action": "deviceRemoveUpdate", "data": {"status": "success", "id": dev}});
          } else {
            self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Не удалось"}});
          }
        }, function() {
          self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Не удалось"}});
        });
        this.notify({"action": "deviceRemoveUpdate", "data": {"status": "started", "id": dev}});
      } catch (e) {
        self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Что-то пошло не так"}});
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
          } else {
            self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Не удалось"}});
          }
        }, function() {
          self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Не удалось"}});
        });
        zway.controller.data.controllerState.bind(ctrlStateUpdater);
      } catch (e) {
        self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Что-то пошло не так"}});
      }
    }
  } else {
    self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Что-то пошло не так (не нашёл устройство или zway)"}});
  }
};

O7.prototype.stopDeviceRemove  = function (dev) {
  var self = this,
      o7Dev = this.devices.get(dev);

  if (!o7Dev) {
    this.debug("Device " + dev + " not found");
    self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Устройство не найдено"}});
  }

  this.debug("Stop device remove");

  if (ZWave && ZWave[o7Dev.zwayName] && ZWave[o7Dev.zwayName].zway && ZWave[o7Dev.zwayName].zway.devices[o7Dev.zwayId]) {
    var zway = ZWave[o7Dev.zwayName].zway

    // Exclusion mode
    if (zway.controller.data.controllerState.value == 5) {
      zway.controller.RemoveNodeFromNetwork(0);
      self.notify({"action": "deviceRemoveUpdate", "data": {"status": "success", "id": null}});
    } else {
      self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": null, "message": "Контроллер не в режиме исключения"}});
    }
  } else {
    self.notify({"action": "deviceRemoveUpdate", "data": {"status": "failed", "id": dev, "message": "Что-то пошло не так (не нашёл устройство или zway)"}});
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
    self.checkRuleItem(rule, event);
  });
};

O7.prototype.checkRuleItem = function(rule, event) {
  console.logJS(rule); //!!!
  if (rule.state != "enabled") {
    return; // skip
  }

  // rule matches event type
  if (event.type !== rule.event.type) {
    return; // skip
  }

  if (event.type === "atTime") {
    var _date = new Date();

    if (rule.event.hour !== _date.getHours() || rule.event.munite !== _date.getMinutes() && rule.event.weekdays.indexOf(_date.getDay()) === -1) {
      return; // skip
    }
  }

  if (event.type === "deviceChange") {
    console.logJS(event.deviceId, rule.event.deviceId); //!!!
    if (event.deviceId !== rule.event.deviceId) {
      return; // skip
    }
  }

  if (event.type === "homeMode") {
    if (event.mode !== rule.event.mode) {
      return; // skip
    }
  }

  // for event.type === "manual" there is nothing to check

  // rule matches, check condition

  var result = true;
  rule.conditions.forEach(function(condition) {
    console.logJS(condition.type); //!!!
    switch (condition.type) {
      case "deviceState":
        var _dev = controller.devices.get(condition.deviceId);
        if (!_dev) {
          result = false;
          return false;
        }

        var _val = _dev.get("metrics:level");

        if (condition.comparison === "eq") {
          result = result && (_val === condition.value);
        }
        if (condition.comparison === "ne") {
          result = result && (_val !== condition.value);
        }
        if (condition.comparison === "ge") {
          result = result && (_val >= condition.value);
        }
        if (condition.comparison === "le") {
          result = result && (_val <= condition.value);
        }
        console.logJS("res", result); //!!!
        break;

      case "homeMode":
        if (condition.comparison === "eq") {
          result &= self.homeMode === condition.mode;
        }
        if (condition.comparison === "ne") {
          result &= self.homeMode !== condition.mode;
        }
        break;

      case "time":
        var _date = new Date(),
            _time = _date.getHours() * 60 + _date.getHours(),
            _from = condition.fromHour * 60 + condition.fromMinute,
            _to = condition.toHour * 60 + condition.toMinute;

        result &= _from <= _time && _time <= _to;
        break;
    }
  });

  if (!result) {
    return; // skip
  }

  // condition fits

  rule.actions.forEach(function(action) {
    switch (action.type) {
      case "deviceState":
        var _dev = controller.devices.get(action.deviceId);

        if (_dev) {
          _dev.performCommand(action.command, action.args);
        } else {
          self.error("device not found");
        }
        break;

      case "homeMode":
        self.setHomeMode(action.mode);
        break;

      case "cloud":
        self.cloudAction(action.action, action.args);
        break;
    }
  });
};

/*
 * Save new rules
 * @param rules массив JSON-объектов с описанием правил
 */
O7.prototype.rulesSet = function(rules) {
  // мы не делаем валидации здесь. возможно это нужно будет добавить
  this.rules = rules;
};

O7.prototype.rulesGet = function(rules) {
  return this.rules;
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
  return this.homeMode;
};

O7.prototype.setHomeMode = function(mode) {
  this.homeMode = mode;
  this.rulesCheck({type: "homeMode", mode: mode});
  this.notifyHomeModeChange();
};

var o7 = new O7();
