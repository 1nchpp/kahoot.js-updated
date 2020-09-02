const sleep = require("../util/sleep.js");
const LiveFeedbackPacket = require("../assets/LiveFeedbackPacket.js");
module.exports = function(){
  this.handlers.feedback = (message)=>{
    if(message.channel === "/service/player" && message.data && message.data.id === 12){

      /**
       * Feedback Event
       *
       * @event Client#Feedback Emitted when the host requests for feedback
       * @type {Object}
       * @property {String} quizType
       */
      this.feedbackTime = Date.now();
      this._emit("Feedback",JSON.parse(message.data.content));
    }
  };

  /**
   * sendFeedback - Send feedback to the host
   *
   * @param {Number} fun 1-5. Rating for how fun the quiz was
   * @param {Number} learn 0/1. Whether the client learned anything from the quiz
   * @param {Number} recommend 0/1. Whether the client would recommend the quiz
   * @param {Number} overall -1 - 1. The overall feeling of the client.
   */
  this.sendFeedback = async (fun,learn,recommend,overall)=>{
    if(this.gameid[0] === "0"){
      throw "Cannot send feedback in Challenges";
    }
    const wait = Date.now() - this.feedbackTime;
    if(wait < 500){
      await sleep((500 - wait) / 1000);
    }
    return new Promise((resolve, reject)=>{
      this._send(new LiveFeedbackPacket(this,fun,learn,recommend,overall),(result)=>{
        if(!result || !result.successful){
          reject(result);
        }else{
          resolve(result);
        }
      });
    });
  };
};
