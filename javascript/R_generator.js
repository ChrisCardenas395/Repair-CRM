class R_generator {
  temp = "Temp";


  constructor(Temp) {
    this.temp = this.temp;
  }
  
//Add Creation Date
addCDate() {

}

//Add Device Type
addDeviceType() {
  const deviceType = document.getElementById('deviceType');
}

//Add Model Type
addModelType() {
  const modelType = document.getElementById('modelType');
}

//Add Serial Number
addSerialNum() {
  const serialNum = document.getElementById('serialNum');
}

//Add Mei
addMEI() {
  const mei = document.getElementById('mei');
}

//Add Condition
addDeviceCond() {
  const deviceCond = document.getElementById('deviceCond');
}

//Generate Repair ID
genRepairID() {
  //randomize each digit between 0 and 9
  digit1 = Math.floor(Math.random() * 10);
  digit2 = Math.floor(Math.random() * 10);
  digit3 = Math.floor(Math.random() * 10);
  digit4 = Math.floor(Math.random() * 10);
  digit5 = Math.floor(Math.random() * 10);
  digit6 = Math.floor(Math.random() * 10);
  digit7 = Math.floor(Math.random() * 10);
  digit8 = Math.floor(Math.random() * 10);

  //combine all digits
  repairID = `${digit1}${digit2}${digit3}${digit4}${digit5}${digit6}${digit7}${digit8}` 

  return repairID;
}

//Generate Personalized Link
genPersonalizedLink() {
  const baseURL = new URL("https://customerrepair.com");

  const userData = {
    name: "TBD", id: "TBD", device: "tbd"
  }

  targetUrl.searchParams.set("user", userData.name);
  targetUrl.searchParams.set("id", userData.id);
  targetUrl.searchParams.set("device", userData.device);

  const personalizedlink = targetUrl.href;
  console.log(personalizedLink);
}

}
