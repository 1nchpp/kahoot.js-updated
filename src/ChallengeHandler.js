const consts = require("./consts.js");
const userAgents = require("user-agents");
const EventEmitter = require("events");
const Promise = require("promise");
const http = require("http");
const https = require("https");

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
		this.phase = "start";
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
    this.getProgress().then(inf=>{
      this.challengeData = inf;
			if(inf.challenge.endTime <= Date.now() || inf.challenge.challengeUsersList.length >= inf.challenge.maxPlayers){
				// quiz already ended or is full
				this.emit("quizEnd");
			}else{
				this.emit("ready");
			}
    }).catch(e=>{console.log(e)});
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
			uri = new URL((proxy || "") + url);
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
				if(!p.questionMetrics){
					break;
				}
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
				if(this.kahoot.options.ChallengeAutoContinue){
					setTimeout(()=>{this.next();},5000);
				}
				return;
			}
			this.sendHttpRequest(`https://${consts.ENDPOINT_URI}${consts.CHALLENGE_ENDPOINT}${this.challengeData.challenge.challengeId}/join/?nickname=${this.name}`,{method:"POST"},this.proxy,true).then(data=>{
				Object.assign(this.challengeData,data);
				this.clientID = data.playerCid;
				resolve(this.challengeData);
				this.emit("joined");
				if(this.kahoot.options.ChallengeAutoContinue){
					setTimeout(()=>{this.next();},5000);
				}
			});
		});
  }
  // handles the logic of continuing to the next steps.
  next(){
		switch (this.phase) {
			case "start":
				console.log(0)
				// start quiz
				this.phase = "ready";
				const kahoot = this.challengeData.kahoot;
				let qqa = [];
				console.log(1)
				for(let question of kahoot.questions){
					qqa.push(question.choices ? question.choices.length : null);
				}
				console.log(2)
				this.emit("quizData",Object.assign(this.challengeData.kahoot,{
					name: kahoot.title,
					qCount: null,
					totalQ: kahoot.questions.length,
					quizQuestionAnswers: qqa
				}));
				console.log(3)
				setTimeout(()=>{this.next();},5000);
				console.log(4)
				break;
			case "ready":
				this.phase = "answer";
				var q = this.challengeData.kahoot.questions[this.questionIndex];
				this.emit("quizUpdate",Object.assign(q,{
					questionIndex: this.questionIndex,
					timeLeft: 5000,
					type: q.type,
					useStoryBlocks: false
				}));
				setTimeout(()=>{this.next();},5000);
				break;
			case "answer":
				var q = this.challengeData.kahoot.questions[this.questionIndex];
				this.emit("questionStart");
				this.phase = "leaderboard";
				if(this.kahoot.options.ChallengeAutoContinue){
					const question = q;
					let c = [];
					for(let choice of question.choices){
						if(choice.correct){
							c.push(choice.answer);
						}
					}
					const event = {
						correctAnswers: c,
						correctAnswer: c[0],
						text: c.join("|"),
						correct: false,
						nemesis: this._getNemesis(),
						points: 0,
						rank: this._getRank(),
						totalScore: this.score,
						pointsData: {
							answerStreakPoints: {
								answerStreakBonus: 0,
								streakLevel: 0
							}
						}
					};
					if(this.challengeData.challenge.game_options.question_timer){
						this.ti = setTimeout(()=>{
							// didnt answer
							this.boost = 0;
							this.emit("questionEnd",event);
							this.next();
						},q.time);
					}else{
						this.ti = setTimeout(()=>{
							// didnt answer
							this.boost = 0;
							this.emit("questionEnd",event);
							this.next();
						},1000 * 120);
					}
				}
				break;
			case "leaderboard":
				this.questionIndex++;
				this.phase = "ready";
				if(this.questionIndex == this.challengeData.kahoot.questions.length){
					this.phase = "close";
					if(this.kahoot.options.ChallengeAutoContinue){
						setTimeout(()=>{this.next();},5000);
					}
					return;
				}
				if(this.kahoot.options.ChallengeAutoContinue){
					setTimeout(()=>{this.next();},5000);
				}
				break;
			case "close":
				this.phase = "complete";
				this.emit("finish",{
					playerCount: this.challengeData.challenge.challengeUsersList.length + 1,
					quizID: this.challengeData.kahoot.uuid,
					rank: this._getRank(),
					correct: 0,
					incorrect: 0
				});
				this.emit("finishText",{
					metal: ["gold","silver","bronze"][this._getRank()]
				});
				if(this.kahoot.options.ChallengeAutoContinue){
					setTimeout(()=>{this.next();},5000);
				}
				break;
			case "complete":
				this.emit("quizEnd");
				break;
		}
  }
  getProgress(question){
    if(typeof question != "undefined"){
			return new Promise((resolve, reject)=>{
				this.sendHttpRequest(`https://${consts.ENDPOINT_URI}${consts.CHALLENGE_ENDPOINT}${this.challengeData.challenge.challengeId}progress/?upToQuestion=${question}`,null,this.proxy,true).then(data=>{
					resolve(data);
				});
			});;
    }else{ // first login. get data
			return new Promise((resolve, reject)=>{
				this.sendHttpRequest(`https://${consts.ENDPOINT_URI}${consts.CHALLENGE_ENDPOINT}pin/${this.kahoot.sessionID}`,null,this.proxy,true).then(data=>{
					this.sendHttpRequest(`https://${consts.ENDPOINT_URI}${consts.CHALLENGE_ENDPOINT}${data.challenge.challengeId}/progress`,null,this.proxy,true).then(data2=>{
						resolve(Object.assign(data,{progress:data2}));
					});
				});
			});;
    }
  }
  leave(){
    return;
  }
  sendSubmit(choice,question,secret){
		// TODO: resolve any issues with slides, fix multiple_select_quiz
		// TODO: figure out what happens if you run out of time
		// calculate scores, then send http request.
		const tick = Date.now() - this.receivedQuestionTime;
		if(this.kahoot.options.ChallengeGetFullScore){
			tick = 1;
		}
		const usesPoints = question.points;
		const score = (Math.round((1 - ((tick / question.time) / 2)) * 1000) * question.pointsMultiplier) * Number(usesPoints);
		// calculate extra boost. and score.
		if(this.boost == -1){
			this.boost = 0;
			const ent = this.challengeData.progress.playerProgress.playerProgressEntries;
			let falseScore = 0;
			for(let q in ent){
				if(ent[q].questionMetrics[this.name] > falseScore || !this.challengeData.kahoot.questions[q].points){
					this.boost++;
				}else{
					this.boost = 0;
				}
				falseScore = ent[q].questionMetrics[this.name];
				this.score = falseScore;
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
		}else{
			this.boost = 0;
		}
		// get correct answers
		let c = [];
		for(let choice of question.choices){
			if(choice.correct){
				c.push(choice.answer);
			}
		}
		// send the packet!
		const payload = {
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
			case "open_ended":
			case "word_cloud":
				payload.question.answers[0].originalText = text;
				payload.question.answers[0].text = text.toLowerCase().replace(/[~`\!@#\$%\^&*\(\)\{\}\[\];:"'<,.>\?\/\\\|-\_+=]/gm,"");
				break;
			case "jumble":
				payload.question.answers[0].selectedJumbleOrder = choice;
				break;
			case "multiple_select_quiz":
				// currently don't know how multiple_select_quiz works
				payload.question.answers[0].points = payload.question.answers[0].points * percentCorrect;
				break;
			default:

		}
		this.score += payload.question.answers[0].points + payload.question.answers[0].bonusPoints.answerStreakBonus;
		const event = {
			correctAnswers: c,
			correctAnswer: c[0],
			text: c.join("|"),
			correct: correct,
			nemesis: this._getNemesis(),
			points: payload.question.answers[0].points,
			rank: this._getRank(),
			totalScore: this.score,
			pointsData: {
				answerStreakPoints: {
					answerStreakBonus: calculateStreakPoints(this.boost),
					streakLevel: this.boost
				}
			}
		};
		this.sendHttpRequest(`https://${consts.ENDPOINT_URI}${consts.CHALLENGE_ENDPOINT}${this.challengeData.challenge.challengeId}answers`,{
			headers: {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(JSON.stringify(payload))
			},
			method: "POST"
		},this.proxy,false,JSON.stringify(payload)).then(()=>{
			this.emit("questionSubmit");
			this.ti = setTimeout(()=>{
				clearTimeout(this.ti);
				this.emit("questionEnd",event);
				this.next();
			},300);
		});
  }
  send2Step(){
    return;
  }
  sendFeedback(){
    return;
  }
	_getNemesis(){
		const scores = Array.from(this.challengeData.progress.playerProgress.playerProgressEntries);
		const latest = scores.reverse()[0].questionMetrics;
		let rank = 0;
		let nemesisName = null;
		let nemesisScore = 0;
		for(let i in latest){
			if(i == this.name){
				continue;
			}
			if(latest[i] >= this.score){
				rank++;
				if(latest[i] > nemesisScore){
					nemesisName = i;
					nemesisScore = latest[i];
				}
			}
		}
		if(rank){
			return {
				name: nemesisName,
				isGhost: false,
				totalScore: nemesisScore,
				rank: rank
			};
		}
		return null;
	}
	_getRank(){
		const nem = this._getNemesis();
		if(nem){
			return nem.rank + 1;
		}else{
			return 1;
		}
	}
}
module.exports = ChallengeHandler;
