// node express 백엔드 환경입니다
// node 환경에서 express(백엔드 라이브러리)를 사용하기 위해 require로 임포트 합니다
const express = require("express");
require('dotenv').config();
// express 라이브러리에서 지원하는 cors 미들웨어를 반환하는 함수입니다
// 이걸 express의 use에 넘기면 해당 미들웨어가 적용됩니다
const cors = require("cors");

const app = express();
app.use(cors()); 

const DEFAULT_API_KEY = process.env.DEFAULT_API_KEY;

// api key 유효한지를 확인하는 엔드포인트입니다, apikey 변경시에만 사용합니다
app.get("/api/status", async(req, res) => {
    try {
        const apiKey = req.query.apiKey
        const response = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=76561198181739210`
        ).then(response=> {
            if (response.ok) {
                res.status(200).send()
            }
            else if (response.status == 429) {
                res.status(429).json({message: "Too many request"})
            }
            else { res.status(400).send() }
        });
        
    }
    catch(error) { console.log(error.message); res.status(500).json(error.message) }
})

// 해당 과제에서 메인으로 사용하는 엔드포인트입니다
app.get("/api", async (req, res) => {
    // 전체를 try문으로 감싸후 안에서 status, json 데이터를 검사하여 문제 있을시 throw 하여 catch에서 처리합니다
    try {
        // express api의 url 쿼리에서 apiKey와 steamId(사용자 검색 목적)
        // 을 꺼내서 변수에 저장합니다. 쿼리가 오지 않았으면 undefined 입니다
        let apiKey = req.query.apiKey
        const steamId = req.query.steamId

        if (!apiKey) {
            apiKey = DEFAULT_API_KEY;
        }

        // if 문으로 쿼리가 왔는지 체크, 안왔다면 실패 response을 반환합니다
        if (!(steamId)) { 
            return res.status(400).json({
                error: "Missing required query parameters",
                message: "Please provide both 'steamId' in the query string.",
                example: "/api?steamId=yourSteamId&apiKey=yourApiKey"
        });
        }
         
        // 사용자 정보 api 요청 await 키워드로 비동기 요청을 보내며
        // then 메서드를 통해 Promise 상태가 끝나면(요청을 받아오면)
        // then을 통해 status(요청 성공)을 판별후 json(body의 내용입니다)을 리턴합니다
        const PlayerInfo = await fetch(
            `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`
        ).then( body=> {
            if (body.status == 429) { console.log(body); throw new Error("Too Many Requests") }
            return body.json()
        }).then( res => { // 그 바디의 내용을 한번더 검사합니다, 플레이어 검새결과가 없을경우에도 응답은 200으로 성공이기 때문입니다
            if (res.response.players && res.response.players.length === 0) { throw new Error("No information found")}
            return res
        }
        );
        //console.log(PlayerInfo)

        // 사용자의 게임 목록(소유중인)을 가져옵니다 그 외 위와 같습니다
        const OwnedGames = await fetch(
            `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`
        ).then( (res)=> {
            if (res.status == 429) { console.log(res); throw new Error("Too Many Requests") }
            return res.json()
        }).then( (body)=> {
            if (Object.keys(body.response).length === 0) { throw new Error("Profile is not public") }
            return body
        });
        
        // 위의 응답 내용중 games(Array 타입)의 map 메서드를 통해서 appid만 빼내서 다른 배열로 저장
        let appids = OwnedGames.response.games.map(game => game.appid);



        // 사용자가 가지고 있는 게임의 게임들의 정보 가져오기
        // steam store api 를 사용

        // 조금 어려웠던 부분입니다 먼저 Promise.all의 경우 매게변수로 배열을 받으며
        // 해당 배열의 요소들은 각각 Promise를 리턴후 처리가 끝나면(이 경우 api 요청 응답) 그때 실데이터로 바뀝니다
        // 그리고 그 모든 배열이 다 Promise 상태가 끝나면 그때 Promise.all의 반환 값 또한 Promise에서
        // 배열로 바뀌게 됩니다, 위와 같이 await으로 그걸 기다렸다가 끝나면 변수에 넣습니다
        const games = (await Promise.all(
            // 게임 목록을 가지고 map 메서드를 각각의 appid를 기반으로 게임 정보를 요청을 보냄
            appids.map(async appid => {
                const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=kr&l=korean&filters=price_overview,release_date`
                    ).then( response => { // 요청 성공 확인후 json(json은 body)을 리턴합니다 
                        if (response.status == 429) { console.log(response.headers); throw new Error("Too Many Requests") }
                        return response.json()
                    })          // 이부분이 좀 특이한데 게임정보가 비공개여도 응답 실패가 아니기 때문에
                                //  success 정보를 확인해 false일 경우 null로 대체합니다 
                return res[appid].success ? res : null
            })  // 그 다음 filter을 통해 그 null들을 제거합니다
        )).filter(item => item !== null
        ).reduce((acc, obj) => { // 현재 까지는 배열의 구조가 [{},{},{}] 이기 때문에 이걸 한 객체로 만들기 위해 reduce 사용
            return { ...acc, ...obj };
        }, {});

        
        //console.log(games)
        

        // 메인 html에서 가격기준 정렬을 하기위해 OwnedGames의 배열에 price 값을 추가해서 새로운 변수를 만듦니다
        // 게임이 공짜이거나(공짜일 경우 store 정보의 price_overview가 없는 경우가 있음, 옛날게임이 주로 그럼)
        // store의 내용을 공개하지 않았을경우 0원으로 처리하기 위하여 삼항 조건식을 사용
        const new_OwnedGames = {
            ...OwnedGames.response,
            games: OwnedGames.response.games.map(item=>{
                //console.log(games[item.appid])       
                return {...item, price: (games[item.appid] && games[item.appid].data.price_overview) ? games[item.appid].data.price_overview.initial : 0 }
            })
        }

        
        // 각 게임별 사용자의 도전과제 정보(클리어 정보, 클리어 시간 등등)
        // 이 경우도 appid를 추가하여줌 (새로운 Object를 만들지 않고 동적으로 키 추가)
        // 여기서 따로 try 문으로 엮은 이유는 playerAchievements 정보의 경우 사용자가 프로필을 공개 해놓지 않으면
        // 403 실패가 되며 그 겨우 playerAchievements만 제외하고 보내기 위함
        //               상위 try문에서 catch하면 이전 4개의 응답을 사용할수가 없음
        // 결과적으로 이중 try문이 됩니다
        try {
            const playerAchievements = (await Promise.all(
                appids.map(async appid=>{
                    const res = await fetch(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${apiKey}&steamid=${steamId}&appid=${appid}`                    
                        ).then(res => { 
                            if (res.status == 429) { throw new Error("Too Many Requests") }
                            
                            // 계정의 프로필 정보가 공개가 아닐경우 접근불가하여 403 실패 발생
                            // 이 경우 에러 throw 후 도전과제 클리어 정보만 제외하여 응답을 보냅니다
                            if (res.status == 403) { throw new Error("Profile is not public") }
                            return res.json()
                        })
                    return res.playerstats.success ? {[appid]: res} : null
                })      // 이 경우도 success 실패시 null로 변경후 필터로 제거
            )).filter(item => item !== null
            ).reduce((acc, obj) => {
                return { ...acc, ...obj };
        }, {});

        // 각 게임들의 도전과제 목록을 가져오는 api
        // 위와 거의 똑같지만 다른점은 응답값에 게임을 구분할 정보가 담겨져 있지 않음
        // 그렇기에 map의 리턴값을 새로운 구조의 Object로 만들어서 리턴
        // Object의 키값을 동적으로(각 게임의 키에 맞게) 하기 위해 appid를 [] 로 감싸
        // appid라는 key가 아닌 appid 변수 안 값을 키로 사용 그 외 위와 같음
        const achievements = (await Promise.all(
            appids.map(async appid=> {
                const res = await fetch(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appid}&l=koreana`                   
                ).then( res => {
                    if (res.status == 429) { throw new Error("Too Many Requests") }
                    return res.json()
                    })
                return res.game && res.game.gameVersion ? {[appid]: res} : null
            })
        )).filter(item => item !== null
        ).reduce((acc, obj) => {
            return { ...acc, ...obj };
        }, {});

        // 이렇게 5개의 엔드포인트에서 수집한 데이터를 하나의 객체로 만들어서
        res_body = {
            PlayerInfo: PlayerInfo.response.players[0],
            OwnedGames: new_OwnedGames,
            games: games,
            achievements: achievements,
            playerAchievements: playerAchievements
        }
        
        //console.log("전송 성공");
        // 응답을 보냅니다
        res.status(200).json(res_body);

        // 이중 try문중 안쪽 try의 catch입니다
        } catch(error) {
            // 상위 try에서 처리해야 할경우 그대로 throw하여 넘깁니다
            if (error.message == "Too Many Requests") { throw error }
            // 여기가 403 처리 입니다 playerAchievements만 제외하고 전부 실어서 응답에 넣습니다
            else if (error.message == "Profile is not public") {
            res_body = {
                PlayerInfo: PlayerInfo.response.players[0],
                OwnedGames: new_OwnedGames,
                games: games,
                achievements: achievements
            }
            //console.log("프로필 일부 비공개, 일부 데이터만 전송");
            // 이떄 클라이언트 쪽에서는 playerAchievements를 제외한 데이터는 표시할것이기 때문에
            // 완전 실패는 X, 그렇기에 206으로 표현했습니다
            res.status(206).json(res_body);
            }
        } 

    } catch (error) {
        console.log(error.message)
        // 각각의 Error을 message 멤버를 통해 구분하여 그에 맞는 실패 응답을 보냅니다
        if (error.message == "Too Many Requests") { console.log("api key 요청 과다 임시 차단"); res.status(429).json({ error: error.message }); }
        else if (error.message == "No information found") { console.log("No information found"); res.status(400).json( {error: error.message}); }
        else if (error.message == "Profile is not public") { console.log("Profile is not public"); res.status(403).json( {error: error.message}); }
        // 그외의 예외는 전부 500 서버 오류라고 판단하고 500으로 응답을 보냅니다
        else {res.status(500).json({ error: error.message });}
    }
});

app.listen(3000, () => console.log("Proxy server running on port 3000"));
