class R_Device {
  deviceid = "Need ID";
  devicetype = "Need Device Type";
  devicebrand = "Need Device Brand";
  devicemodel = "Need Device Model";
  deviceserial = "Need Device Serial Number";


  constructor(deviceid,devicetype, devicebrand, devicemodel, deviceserial) {
    this.deviceid = deviceid;
    this.devicetype = devicetype;
    this.devicebrand = devicebrand;
    this.devicemodel = devicemodel;
    this.deviceserial = deviceserial;
  }

    // GETTERS
    getDeviceId() {
        return this.deviceid;
    }

    getDeviceType() {
        return this.devicetype;
    }

    getDeviceBrand() {
        return this.devicebrand;
    }

    getDeviceModel() {
        return this.devicemodel;
    }

    getDeviceSerial() {
        return this.deviceserial;
    }

    // SETTERS
    setDeviceId(deviceid) {
        this.deviceid = deviceid;
    }

    setDeviceType(devicetype) {
        this.devicetype = devicetype;
    }

    setDeviceBrand(devicebrand) {
        this.devicebrand = devicebrand;
    }

    setDeviceModel(devicemodel) {
        this.devicemodel = devicemodel;
    }

    setDeviceSerial(deviceserial) {
        this.deviceserial = deviceserial;
    }

  
  
}