class R_part {
  partid = "Temp";
  partName = "Temp";
  status = "Temp";
  quantity = "Temp";


  constructor(partid, partName, status, quantity) {
    this.partid = partid;
    this.partName = partName; 
    this.status = status;
    this.quantity = quantity;
  }

  // GETTERS
    getPartID() {
        return this.partid;
    }

    getPartName() {
        return this.partName;
    }

    getStatus() {
        return this.status;
    }

    getQuantity() {
        return this.quantity;
    }

    // SETTERS
    setPartID(partid) {
        this.partid = partid;
    }

    setPartName(partName) {
        this.partName = partName;
    }

    setStatus(status) {
        this.status = status;
    }

    setQuantity(quantity) {
        this.quantity = quantity;
    }

    //methods
    updatePartStatus(newStatus) {
    this.setStatus(newStatus); //uses setter to pass into instance variable of status
    }
    
    addPart(amount) {
      if (Number.isInteger(amount) && amount > 0) { //only allows positive numbers
        this.setQuantity(this.getQuantity() + amount);
      }
    }

    removePart(amount) {
      if (Number.isInteger(amount) && amount > 0 &&
        amount <= this.getQuantity()) { //parts removed cannot be less than total parts
        this.setQuantity(this.getQuantity() - amount);
      }
    }
 
  
}