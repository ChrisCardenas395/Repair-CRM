class R_order {
  repairid = "Temp";
  devicetype = "Temp";
  datecreated = "Temp";
  status = "Temp";
  editdates = "Temp";
  photos = "Temp";
  repairstatus = "Temp";
  personallink = "Temp";

  constructor(repairid,devicetype,datecreated,status,editdates,photos,repairstatus,personallink) {
    this.repairid = this.repairid;
    this.devicetype = this.devicetype;
    this.datecreated = this.datecreated;
    this.status = this.status;
    this.editdates = this.editdates;
    this.photos = this.photos;
    this.repairstatus = this.repairstatus;
    this.personallink = this.personallink;
  }
  

    // GETTERS
    getRepairId() {
        return this.repairid;
    }

    getDeviceType() {
        return this.devicetype;
    }

    getDateCreated() {
        return this.datecreated;
    }

    getStatus() {
        return this.status;
    }

    getEditDates() {
        return this.editdates;
    }

    getPhotos() {
        return this.photos;
    }

    getRepairStatus() {
        return this.repairstatus;
    }

    getPersonalLink() {
        return this.personallink;
    }

    // SETTERS
    setRepairId(repairid) {
        this.repairid = repairid;
    }

    setDeviceType(devicetype) {
        this.devicetype = devicetype;
    }

    setDateCreated(datecreated) {
        this.datecreated = datecreated;
    }

    setStatus(status) {
        this.status = status;
    }

    setEditDates(editdates) {
        this.editdates = editdates;
    }

    setPhotos(photos) {
        this.photos = photos;
    }

    setRepairStatus(repairstatus) {
        this.repairstatus = repairstatus;
    }

    setPersonalLink(personallink) {
        this.personallink = personallink;
    }

}