// 從 https://app.gather.town/apikeys 取得的 API Key（請保護好勿外流）
const GATHER_API_KEY = '__CHANGE_ME__';
// 房間名稱
const SPACE_ID = "DWVbCODkTfRGgDPS/g0vjothon";
// SLACK_TOKEN ，為了要同步到 slack 用的
const SLACK_TOKEN = '__CHANGE_ME__';
// BOT_USERID ，為了讓機器人自己的動作不要觸發事件，因為自己的使用者名稱是讀不到的
const BOT_USERID = '__CHANGE_ME__';

const fs = require('fs');
const child_process = require('child_process');
const { Game, MoveDirection } = require("@gathertown/gather-game-client");
global.WebSocket = require("isomorphic-ws");

var enterAt = false;

const game = new Game(() => Promise.resolve({ apiKey: GATHER_API_KEY }));
game.connect(SPACE_ID); 
game.subscribeToConnection((connected) => {
    console.log("connected?", connected)
	console.log("setting name and status");
    // 連線完成之後要修改顯示名稱狀態以及重生
	game.engine.sendAction({
		$case: "setName",
		setName: {
			name: "Jothon Bot 揪松機器人",
		},
	});
	game.engine.sendAction({
		$case: "setTextStatus",
		setTextStatus: {
			textStatus: "我是機器人",
		},
	});
	game.engine.sendAction({
		$case: "respawn",
        respawn: {},
	});
    eventLoop();
});

var info = {
    players: {},
    chats: [],
    player_secret: {},
    updated_at: 0,
};

// 資訊寫入 info.json
if (fs.existsSync('info.json')) {
    info = JSON.parse(fs.readFileSync('info.json'));
}

// 處理 playerChats, playerJoins, playerExits, playerMoves, playerSetsTextStatus 等動作，先塞入 eventPool 中，因為 playerJoins 事件觸發時可能還沒有來的及讀入使用者顯示名稱，需要等使用者顯示名稱讀入後再觸發時間
game.subscribeToEvent("playerChats", (data, _context) => {
    eventPool.push(['playerChats', data.playerChats.senderId, data]);
});

game.subscribeToEvent('playerJoins', (data, _context) => {
    eventPool.push(['playerJoins', _context.playerId, data]);
});

game.subscribeToEvent('playerExits', (data, _context) => {
    eventPool.push(['playerExits', _context.playerId, data]);
});

game.subscribeToEvent("playerMoves", (data, _context) => {
    eventPool.push(['playerMoves', _context.playerId, data]);
});

game.subscribeToEvent('playerSetsTextStatus', (data, _context) => {
    eventPool.push(['playerSetsTextStatus', _context.playerId, data]);
});

// 自己處理的 eventBind，確保等使用者的顯示名稱資訊有被讀入了再觸發事件
var eventPool = [];
var eventHandlers = {};
var eventBind = function(event, callback) {
    if ('undefined' === typeof(eventHandlers[event])) {
        eventHandlers[event] = [];
    }
    eventHandlers[event].push(callback);
};

var eventTrigger = function(event, data) {
    if ('undefined' === typeof(eventHandlers[event])) {
        return;
    }
    eventHandlers[event].map(function(cb){
        cb(data);
    });
};

// 處理有使用者說話
eventBind('playerChats', function(data) {
    if ('undefined' === typeof(game.players[data.playerId])) {
        return;
    }
    if (data.data.playerChats.messageType == 'DM') {
        var message = '您正對我私訊，但我只是個機器人，你是不是傳錯人了呢？';
        game.chat(data.playerId, [], "揪松機器人", message);
    } else {
        // 將聊天訊息同步到 slack
        cmd = 'curl -XPOST -d "text=' + encodeURIComponent(data.data.playerChats.contents) + '" "https://slack.com/api/chat.postMessage?token=' + encodeURIComponent(SLACK_TOKEN) + '&channel=' + encodeURIComponent('#general') + '&username=' + encodeURIComponent(data.data.playerChats.senderName + '(gather)') + '"';
console.log(cmd);
        child_process.exec(cmd);
        info.chats.push([data.data.playerChats.senderName, data.data.playerChats.contents, data.data.playerChats.unixTime]);
        info.updated_at = (new Date()).getTime();
    }
});

// 在 info 變數更新使用者資訊
var updateInfoPlayer = function(id) {
    if ('undefined' !== typeof(game.players[id])) {
        if ('undefined' == typeof(info.players[id])) {
            info.players[id] = {
                first_at: Math.floor((new Date).getTime() / 1000),
            };
        }
        info.players[id].data = game.players[id];
        info.players[id].login_at = (new Date).getTime() / 1000;
        info.players[id].logout_at = 0;
    } else {
        info.players[id].logout_at = (new Date).getTime() / 1000;
    }
    if (!info.players[id].secret) {
        info.players[id].secret = (Math.random() + 1).toString(36).substring(2);
        info.player_secret[info.players[id].secret] = id;
    }
    info.updated_at = (new Date()).getTime();
};

// 處理使用者加入事件
eventBind('playerJoins', function(data) {
    console.log(data.playerId + " joined");
    updateInfoPlayer(data.playerId);
    if (enterAt && (new Date).getTime() > (enterAt.getTime() + 1000)) {
        if (game.players[data.playerId].textStatus) {
            var message = "您好，我是揪松機器人，歡迎參加大松，您的關鍵字為 " + game.players[data.playerId].textStatus + "，我將會幫您做介紹";
        } else {
            var message = "您好，我是揪松機器人，歡迎參加大松，您可以點選畫面下方中間您的名字，在 Add text status 輸入您的關鍵字喔";
        }
        message += '，您可至 https://aws.ronny.tw/gather/s/?' + info.players[data.playerId].secret + ' 更新您的資料';
        setTimeout(()=>{
            game.chat(data.playerId, [], "", message);
            console.log('對新人做介紹: ' + data.playerId);
        }, 1000);
    }
});

// 遇到 playerSetsTextStatus, playerExits, playerMoves 等事件時更新 info
eventBind('playerSetsTextStatus', function(data) {
    updateInfoPlayer(data.playerId);
});
eventBind('playerExits', function(data) {
    console.log(data.playerId + " exited");
    updateInfoPlayer(data.playerId);
});
eventBind('playerMoves', function(data) {
    updateInfoPlayer(data.playerId);
});

var infoLastUpdatedAt = 0;
var eventLoop = function(){
    process.stderr.write(String.fromCharCode(27) + 'k' + (new Date).toTimeString().split(' ')[0] + ' ' + eventPool.length + String.fromCharCode(27) + "\\")
    if (eventPool.length) {
        console.log(enterAt + ' ' + JSON.stringify(eventPool));
    }
    while (eventPool.length) {
        acted = false;
        for (var idx in eventPool) { 
            firstEvent = eventPool[idx];
            if (firstEvent[1] == BOT_USERID) {
                if (!enterAt) {
                    enterAt = new Date;
                }
                eventPool = eventPool.slice(0, idx).concat(eventPool.slice(idx + 1));
                acted = true;
                break;
            }
            if ('undefined' !== typeof(game.players[firstEvent[1]]) && '' == game.players[firstEvent[1]].outfitString) {
                continue;
            }

            eventTrigger(firstEvent[0], {playerId: firstEvent[1], data: firstEvent[2]});
            eventPool = eventPool.slice(0, idx).concat(eventPool.slice(idx + 1));
            acted = true;
            break;
        }
        if (acted) {
            continue;
        }
        break;
    }
    
    if (infoLastUpdatedAt != info.updated_at) {
        infoLastUpdatedAt = info.updated_at;
        fs.writeFile('info.json', JSON.stringify(info), function(){});
    }

    setTimeout(eventLoop, 1000);
};

