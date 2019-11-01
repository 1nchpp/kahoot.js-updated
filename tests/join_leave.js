var Kahoot = require("../index.js");
var client = new Kahoot;
const PIN = parseInt(require("fs").readFileSync("PIN.txt"));
console.log("joining game...");
client.join(PIN, "testing");
client.on("ready", () => {
    console.log("joined. leaving..");
    setTimeout(()=>{client.leave();},5000);
});
client.on("invalidName",()=>{
  console.log("bad");
  setTimeout(()=>{client.join("testing2");},5000);
});
