const consts = require("./consts.js");
const userAgents = require("user-agents");
const EventEmitter = require("events");
const Promise = require("promise");

function calculateStreakPoints(n){
	if(n >= 6){
		return 500;
	}else if(n <= 1){
		return 0;
	}else{
		return (n - 1) * 100;
	}
}

class ChallengeHandler extends EventEmitter {
	constructor(kahoot,content,proxy) {
		super();
		this.kahoot = kahoot;
		this.clientID = "_none_";
		this.name = "";
    this.challengeData = content;
    this.proxy = proxy;
    const u = new userAgents();
    this.userAgent = u.toString();
    this.userAgentMeta = {
      width: u.screenWidth,
      height: u.screenHeight
    };
		this.questionIndex = 0;
		this.score = 0;
		this.boost = -1;
    this.receivedQuestionTime = 0;
    // to prevent certain things from crashing
    this.ws = {
      emit: ()=>{},
      on: ()=>{},
      once: ()=>{},
      send: ()=>{},
      close: ()=>{},
      terminate: ()=>{},
      readyState: 3,
      addEventListener: ()=>{}
    };
    getProgress().then(inf=>{
      this.challengeData.progress = inf;
			if(inf.challenge.emdTime >= Date.now() || inf.challenge.challengeUsersList.length >= inf.challenge.maxPlayers){
				// quiz already ended or is full
				this.emit("quizEnd");
			}else{
				this.emit("ready");
			}
    });
	}
  sendHttpRequest(url,opts,proxy,isJSON,packet){
    var proxyOptions;
		var nopath;
		if(typeof(proxy) == "string"){
			proxy = proxy || "";
		}else if(proxy && proxy.proxy){
			proxyOptions = proxy.options || {};
			proxy = proxy.proxy;
			nopath = proxy.nopath;
		}else{
			proxy = "";
		}
		var uri;
		if(nopath){ // don't append
			uri = new URL(proxy);
		}else{
			uri = new URL((proxy || "") + url;
		}
		let options = {
			port: consts.ENDPOINT_PORT,
			headers: {
				"user-agent": this.userAgent,
				"host": (proxy && uri.hostname) || "kahoot.it",
				"referer": "https://kahoot.it/",
				"accept-language": "en-US,en;q=0.8",
				"accept": "*/*"
			}
		};
    if(opts){
      Object.assign(options,opts);
    }
		if(proxyOptions){
			Object.assign(options,proxyOptions);
		}
		let proto;
		if(uri.protocol == "https:"){
			proto = https;
		}else{
			proto = http;
		}
    return new Promise((resolve, reject)=>{
      proto.request(uri,options,res=>{
				let chunks = [];
        res.on("data",data=>{
					chunks.push(data);
        });
				res.on("end",()=>{
					const data = Buffer.concat(chunks);
					const body = data.toString("utf8");
          if(isJSON){
            return resolve(JSON.parse(body));
          }
          resolve(body);
				});
      }).on("err",e=>{reject(e)}).end(packet);
    });
  }
  login(name){
		return new Promise((resolve, reject)=>{
			this.name = String(name);
			let count = 0;
			let score = 0;
			for(let p of this.challengeData.progress.playerProgress.playerProgressEntries){
				if(this.name in p.questionMetrics){
					count++;
					score = p.questionMetrics[this.name];
				}else{
					break;
				}
			}
			if(count > 0){
				this.questionIndex = count;
				this.score = score;
				for(let u of this.challengeData.challenge.challengeUsersList){
					if(u.nickname == this.name){
						this.playerCid = u.playerCId;
						break;
					}
				}
				this.emit("joined");
				return;
			}
			this.sendHttpRequest(`https://${consts.ENDPOINT_URI}${consts.CHALLENGE_ENDPOINT}${this.challengeData.challenge.challengeId}/join/?nickname=${this.name}`,{method:"POST"},this.proxy,true).then(data=>{
				Object.assign(this.challengeData,data);
				this.clientID = data.playerCid;
				resolve(this.challengeData);
				this.emit("joined");
			});
		});
  }
  // handles the logic of continuing to the next steps.
  next(){

  }
  getProgress(question){
    if(typeof question != "undefined"){
			return new Promise((resolve, reject)=>{
				this.sendHttpRequest(`https://${consts.ENDPOINT_URI}${consts.CHALLENGE_ENDPOINT}${this.challengeData.challenge.challengeId}progress/?upToQuestion=${question}`,null,thgis.proxy,true).then(data=>{
					resolve(data);
				});
			});;
    }else{ // first login. get data
			return new Promise((resolve, reject)=>{
				this.sendHttpRequest(`https://${consts.ENDPOINT_URI}${consts.CHALLENGE_ENDPOINT}${this.challengeData.challenge.challengeId}progress`,null,this.proxy,true).then(data=>{
					resolve(data);
				});
			});;
    }
  }
  leave(){
    return;
  }
  sendSubmit(choice,question,secret){
		// calculate scores, then send http request.
		const tick = Date.now() - this.receivedQuestionTime;
		if(this.kahoot.options.ChallengeGetFullScore){
			tick = 1;
		}
		const usesPoints = question.points;
		const score = (Math.round((1 - ((tick / question.time) / 2)) * 1000) * question.pointsMultiplier) * Number(usesPoints);
		// calculate extra boost.
		if(boost == -1){
			boost = 0;
			const ent = this.challengeData.progress.playerProgress.playerProgressEntries;
			let falseScore = 0;
			for(let q in ent){
				if(ent[q].questionMetrics[this.name] > falseScore || !this.challengeData.kahoot.questions[q].points){
					boost++;
				}else{
					boost = 0;
				}
				falseScore = ent[q].questionMetrics[this.name];
			}
		}
		// now we have previous streak, determine if correct.
		let correct = false;
		let text = "";
		let choiceIndex = Number(choice);
		let percentCorrect = 0;
		switch (question.type) {
			case "quiz":
				correct = question.choices[choice].correct;
				text = question.choices[choice].answer;
				break;
			case "jumble":
				// the answers aren't randomized, so...
				correct = JSON.stringify(choice) == JSON.stringify([0,1,2,3]);
				for(let n of choice){
					text += question.choices[n].answer + "|";
				}
				text = text.replace(/\|$/,"");
				choiceIndex = -1;
				break;
			case "multiple_select_quiz":
				const totalCorrect = question.choices.filter(ch=>{
					return ch.correct;
				}).length;
				let correctCount = 0;
				for(let ch of choice){
					if(question.choices[ch].correct){
						correct = true;
						correctCount++;
					}else{
						correct = false;
						break;
					}
				}
				percentCorrect = correctCount / totalCorrect;
				for(let ch of choice){
					text += question.choices[ch].answer + "|";
				}
				text = text.replace(/\|$/,"");
				break;
			case "open_ended":
				text = String(choice);
				let spe = [];
				const invalid = /[~`\!@#\$%\^&*\(\)\{\}\[\];:"'<,.>\?\/\\\|-\_+=]/gm;
				const test = text.replace(invalid,"");
				for(choice of question.choices){
					// has text besides emojis
					if(choice.replace(consts.EMOJI_REGEX,"").length){
						correct = test.replace(consts.EMOJI_REGEX,"").toLowerCase() == choice.replace(consts.EMOJI_REGEX,"").replace(invalid,"").toLowerCase();
					}else{
						// only has emojis
						correct = test == choice;
					}
					if(correct){
						choiceIndex = question.choices.indexOf(choice);
						break;
					}
				}
				break;
			case "word_cloud":
				text = choice;
				choiceIndex = -1;
				correct = true;
				break;
			default:
				choiceIndex = choice || 0;
				correct = true;
		}
		// random debug stuff
		if(secret){
			if(secret.correct){
				correct = true;
			}
			if(secret.points){
				score = secret.points;
			}
		}
		if(correct){
			this.boost++;
		}
		// send the packet!
		let payload = {
			device: {
				screen: this.userAgentMeta,
				userAgent: this.userAgent
			},
			gameMode: this.challengeData.progress.gameMode,
			gameOptions: this.challengeData.progress.gameOptions,
			hostOrganizationId: null,
			kickedPlayers: [],
			numQuestions: this.challengeData.kahoot.questions.length,
			organizationId: "",
			question: {
				answers: [
					{
						bonusPoints: {
							answerStreakBonus: question.points ? calculateStreakPoints(this.boost) : 0
						},
						choiceIndex: choiceIndex,
						isCorrect: correct,
						playerCid: this.clientID,
						playerId: this.name,
						points: Number(correct) * score,
						reactionTime: tick,
						receivedTime: this.receivedQuestionTime,
						text: text
					}
				],
				choices: question.choices,
				duration: question.time,
				format: question.questionFormat,
				index: this.questionIndex,
				lag: 0,
				layout: question.layout,
				playerCount: 1,
				pointsQuestion: typeof question.points == "undefined" ? true : question.points,
				skipped: false,
				startTime: 0,
				title: question.question,
				type: question.type,
				video: question.video
			},
			quizId: this.challengeData.kahoot.uuid,
			quizMaster: this.challengeData.challenge.quizMaster,
			quizTitle: this.challengeData.kahoot.title,
			quizType: this.challengeData.progress.quizType,
			sessionId: this.kahoot.sessionID,
			startTime: this.challengeData.progress.timestamp
		};
		switch (question.type) {
			case "quiz":

				break;
			default:

		}
		this.sendHttpRequest(`https://${consts.ENDPOINT_URI}${consts.CHALLENGE_ENDPOINT}${this.challengeData.challenge.challengeId}answers`,{
			headers: {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(JSON.stringify(payload))
			},
			method: "POST"
		},this.proxy,false,JSON.stringify(payload)).then(()=>{
			this.emit("questionSubmit");
		});
  }
  send2Step(){
    return;
  }
  sendFeedback(){
    return;
  }
}
module.exports = ChallengeHandler;
