// node express 백엔드 환경입니다
// node 환경에서 express(백엔드 라이브러리)를 사용하기 위해 require로 임포트 합니다
import express from "express";

import dotenv from 'dotenv';
dotenv.config();

import PQueue from 'p-queue';

import cors from "cors";

import redis from 'redis';
const redisClient = redis.createClient();
await redisClient.connect();

const app = express();
app.use(cors()); 

const DEFAULT_API_KEY = process.env.DEFAULT_API_KEY;

const queue = new PQueue({
  interval: 100,       // 0.1초 간격
  intervalCap: 1       // 한 번에 1개만 처리

});

async function steamDataFetch(apiKey,  steamId) {
    const PlayerInfo = await queue.add(async () => fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`
    )).then( body=> {
        if (body.status == 429) { console.log(body); throw new Error("Too Many Requests") }
        return body.json()
    }).then( res => { // 그 바디의 내용을 한번더 검사합니다, 플레이어 검새결과가 없을경우에도 응답은 200으로 성공이기 때문입니다
        if (res.response.players && res.response.players.length === 0) { throw new Error("No information found")}
        return res
    }
    );
    //console.log(PlayerInfo)

    // 사용자의 게임 목록(소유중인)을 가져옵니다 그 외 위와 같습니다
    const OwnedGames = await queue.add(async () => fetch(
        `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`
    )).then( (res)=> {
        if (res.status == 429) { console.log(res); throw new Error("Too Many Requests") }
        return res.json()
    }).then( (body)=> {
        if (Object.keys(body.response).length === 0) { throw new Error("Profile is not public") }
        return body
    });
    //console.log(OwnedGames)
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
            const cache = await redisClient.get(`game:${appid}`)
            const res = cache ? JSON.parse(cache) : await queue.add(async () => fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=kr&l=korean&filters=price_overview,release_date`
                )).then( response => { // 요청 성공 확인후 json(json은 body)을 리턴합니다 
                    if (response.status == 429) { console.log(response.headers); throw new Error("Too Many Requests") }
                    return response.json()
                    }).then( res => {
                        redisClient.set(`game:${appid}`, JSON.stringify(res))
                        return res
                    })          
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
            return {...item, price: (games[item.appid] && games[item.appid].data?.price_overview) ? games[item.appid].data.price_overview.initial : 0 }
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
                const res = await queue.add(async () => fetch(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${apiKey}&steamid=${steamId}&appid=${appid}`                    
                    )).then(res => { 
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

        const achievements = (await Promise.all(
            appids.map(async appid=> {
                const cache = await redisClient.get(`achi:${appid}`)
                const res = cache ? JSON.parse(cache) : await queue.add(async () => fetch(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appid}&l=koreana`
                )).then( res => {
                    if (res.status == 429) { throw new Error("Too Many Requests") }
                    return res.json()
                    }).then( res => {
                        redisClient.set(`achi:${appid}`, JSON.stringify(res))
                        return res
                    })
                return res.game && res.game.gameVersion ? {[appid]: res} : null
            })
        )).filter(item => item !== null
        ).reduce((acc, obj) => {
            return { ...acc, ...obj };
        }, {});

        return {
            PlayerInfo: PlayerInfo.response.players[0],
            OwnedGames: new_OwnedGames,
            games: games,
            achievements: achievements,
            playerAchievements: playerAchievements,
            update_time: Date.now(),
            need_cache: true
        }
    } catch(error) {
        if (error.message == "Profile is not public") {
            return {
                PlayerInfo: PlayerInfo.response.players[0],
                OwnedGames: new_OwnedGames,
                games: games,
                update_time: Date.now(),
                need_cache: true
            }
        }
        else {
            throw error
        }
    } 
}

// api key 유효한지를 확인하는 엔드포인트입니다, apikey 변경시에만 사용합니다
app.get("/api/status", async(req, res) => {
    try {
        const apiKey = req.query.apiKey
        
        if (!apiKey) {
            return res.status(400).json({
                error: "Missing API key",
                message: "Please provide 'apiKey' in the query string."
            });
        }

        const response = await queue.add(async () => 
            fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=76561198181739210`)
        );

        if (response.ok) {
            res.status(200).json({ message: "API key is valid" });
        }
        else if (response.status === 429) {
            res.status(429).json({ error: "Too Many Requests" });
        }
        else {
            res.status(400).json({ error: "Invalid API key" });
        }
        
    }
    catch(error) { 
        console.log(error.message); 
        res.status(500).json({ error: error.message }); 
    }
})


app.post("/api/cache", async (req, res) => {
    const steamId = req.query.steamId
    if (!steamId) {
        return res.status(400).json({
            error: "Missing required query parameters",
            message: "Please provide both 'steamId' in the query string.",
            example: "/api/cache?steamId=yourSteamId"
        });
    }

    let raw = '';

    req.on('data', chunk => {
        raw += chunk;
    });

    req.on('end', () => {
        redisClient.set(`steamId:${steamId}`, raw);
        redisClient.set(`steamId:update:${steamId}`, Date.now());
        res.status(200).json({ message: "Cache updated" });
    });


})
// 해당 과제에서 메인으로 사용하는 엔드포인트입니다

app.get("/refresh", async (req, res) => {
    let apiKey = req.query.apiKey
    const steamId = req.query.steamId
    
    if (!apiKey) {
        apiKey = DEFAULT_API_KEY;
    }
    
    if (!steamId) {
        return res.status(400).json({
            error: "Missing required query parameters",
            message: "Please provide both 'steamId' in the query string.",
            example: "/refresh?steamId=yourSteamId"
        })
    };

    if (await redisClient.get(`steamId:update:${steamId}`) && Date.now() - await redisClient.get(`steamId:update:${steamId}`) < 1000 * 60 * 60 * 24 * 3) {
        return res.status(204).json({ message: "Cache is up to date" });
    }

    const res_body = await steamDataFetch(apiKey, steamId);
        if (res_body.achievements) {
            res.status(200).json(res_body);
        }
        else {
            res.status(206).json(res_body);
    }

});

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
        //console.log(apiKey)
        //console.log(steamId)
        // if 문으로 쿼리가 왔는지 체크, 안왔다면 실패 response을 반환합니다
        if (!(steamId)) { 
            return res.status(400).json({
                error: "Missing required query parameters",
                message: "Please provide both 'steamId' in the query string.",
                example: "/api?steamId=yourSteamId"
        });
        }
        
        if (await redisClient.get(`steamId:${steamId}`)) {
            return res.status(200).type('application/json').send(await redisClient.get(`steamId:${steamId}`));
        }

        const res_body = await steamDataFetch(apiKey, steamId);
        if (res_body.achievements) {
            res.status(200).json(res_body);
        }
        else {
            res.status(206).json(res_body);
        }
    } catch (error) {
        console.log(error.message)
        
        if (error.message == "Too Many Requests") { console.log("api key 요청 과다 임시 차단"); res.status(429).json({ error: error.message }); }
        else if (error.message == "No information found") { console.log("No information found"); res.status(400).json( {error: error.message}); }
        else if (error.message == "Profile is not public") { console.log("Profile is not public"); res.status(403).json( {error: error.message}); }
        else {res.status(500).json({ error: error.message });}
    }
});

app.listen(3000, () => console.log("Proxy server running on port 3000"));
