class R_order {
  repairid = "Temp";
  devicetype = "Temp";
  datecreated = "Temp";
  status = "Temp";
  editdates = []; //arrays
  photos = []; //arrays
  repairstatus = "Temp";
  personallink = "Temp";

  constructor(repairid,devicetype,datecreated,status,editdates = [], photos = [],repairstatus,personallink) {
    this.repairid = repairid;
    this.devicetype = devicetype;
    this.datecreated = datecreated;
    this.status = status;
    this.editdates = editdates;
    this.photos = photos;
    this.repairstatus = repairstatus;
    this.personallink = personallink;
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
        return this.status; //will have to connect/ udpdate the drag and drop UML to get status
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


    //methods

    updateStatus(newStatus, editDate) {  //updates the repair status and records the date of the change
        this.setStatus(newStatus); 

        if (editDate != null) {
            this.getEditDates().push(editDate); //add date to array of repair order edit dates
        }
    }

    addNote(note, editDate) { //adds a new technician note and records when it was added
        if (typeof note === "string" && note.trim() !== "") {
            if (!this.notes) {
                this.notes = [];
            }

            this.notes.push(note);

            if (editDate != null) {
                this.getEditDates().push(editDate);
            }
        }
    }

    addDiagnosis(diagnosis, editDate) {       //stores technician's diagnosis and records when was added
        if (typeof diagnosis === "string" &&
            diagnosis.trim() !== "") {
            this.diagnosis = diagnosis;

            if (editDate != null) {
                this.getEditDates().push(editDate);
            }
        }
    }

    getLink() { //retrieves personalized link for customer's repair order
        return this.getPersonalLink();
    }

    uploadPhoto(photo, editDate) { //adds a photo to repair order and records when was uploaded
        if (photo != null) {
            this.getPhotos().push(photo);

            if (editDate != null) {
                this.getEditDates().push(editDate);
            }
        }
    }

    updateNote(noteIndex, updatedNote, editDate) { //updates existing note and records when was changed
        if (Number.isInteger(noteIndex) &&
            noteIndex >= 0 &&
            noteIndex < this.notes.length &&
            typeof updatedNote === "string" &&
            updatedNote.trim() !== "") {

            this.notes[noteIndex] = updatedNote;

            if (editDate != null) {
                this.getEditDates().push(editDate);
            }
        }
    }

    getPublicView() { //calls the repair information that can be displayed to the customer
        return {
            repairId: this.getRepairId(),
            deviceType: this.getDeviceType(),
            dateCreated: this.getDateCreated(),
            status: this.getStatus(),
            repairStatus: this.getRepairStatus(),
            photos: this.getPhotos()
        };
    }






}