const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors()); 

app.get("/api", async (req, res) => {
    try {
        // express api의 url 쿼리에서 apiKey와 steamId(사용자 검색 목적)
        // 을 꺼내서 변수에 저장합니다. 쿼리가 오지 않았으면 undefined 입니다
        const apiKey = req.query.apiKey
        const steamId = req.query.steamId

        // if 문으로 쿼리가 왔는지 체크, 안왔다면 실패 response을 반환합니다
        if (!(steamId || apiKey)) { 
            return res.status(400).json({
                error: "Missing required query parameters",
                message: "Please provide both 'steamId' or 'apiKey' in the query string.",
                example: "/api?steamId=yourSteamId&apiKey=yourApiKey"
        });
         }
         
        // 사용자 정보 api 요청 await 키워드로 비동기 요청을 보내며
        // then 메서드를 통해 Promise 상태가 끝나면(요청을 받아오면)
        // res.json() 으로 바디의 내용을 최종적으로 리턴시킵니다
        // 여기서 람다식의 e 의 경우 Response 객체이며 fetch의 반환값입니다
        const PlayerInfo = await fetch(
            `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`
        ).then( body=> {
            if (body.status == 429) { console.log(body); throw new Error("Too Many Requests") }
            return body.json()
        });
        console.log(PlayerInfo)
        // 사용자의 게임 목록(소유중인)을 가져옵니다 그외 위와 같습니다
        const OwnedGames = await fetch(
            `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`
        ).then( (body)=> {
            if (body.status == 429) { console.log(body); throw new Error("Too Many Requests") }
            return body.json()
        });
        console.log(OwnedGames)
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
                const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=price_overview,release_date  `
                ).then( body => {
                if (body.status == 429) { console.log(body.headers); throw new Error("Too Many Requests") }
                return body.json()
                })
                return res[appid].success ? res : null
            })
        )).filter(item => item !== null
        ).reduce((acc, obj) => {
            return { ...acc, ...obj };
        }, {});

        
        console.log(games)
        // 각 게임들의 도전과제 목록을 가져오는 api
        // 위와 거의 똑같지만 다른점은 응답값에 게임을 구분할 정보가 담겨져 있지 않음
        // 그렇기에 새로운 Object를 만들어서 appid를 키값으로 응답의 바디를 value로 넣음
        const achievements = (await Promise.all(
            appids.map(async appid=> {
                const res = await fetch(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appid}&l=koreana`                   
                ).then( body => {
                if (body.status == 429) { throw new Error("Too Many Requests") }
                return body.json()
                })
                return res.game && res.game.gameVersion ? {[appid]: res} : null
            })
        )).filter(item => item !== null
        ).reduce((acc, obj) => {
            return { ...acc, ...obj };
        }, {});

        // 각 게임별 사용자의 도전과제 정보(클리어 정보, 클리어 시간 등등)
        // 이 경우도 appid를 추가하여줌 (새로운 Object를 만들지 않고 동적으로 키 추가)
        const playerAchievements = (await Promise.all(
            appids.map(async appid=>{
                const res = await fetch(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${apiKey}&steamid=${steamId}&appid=${appid}`                    
                ).then(body => {
                if (body.status == 429) { console.log(body.headers);  throw new Error("Too Many Requests") }
                return body.json()
                })
                return res.playerstats.success ? {[appid]: res} : null
            })
        )).filter(item => item !== null
        ).reduce((acc, obj) => {
            return { ...acc, ...obj };
        }, {});

        console.log(playerAchievements)

        const new_OwnedGames = {
            ...OwnedGames.response,
            games: OwnedGames.response.games.map(item=>{
                console.log(games[item.appid])
                return {...item, price: (games[item.appid] && games[item.appid].data.price_overview) ? games[item.appid].data.price_overview.final : 0 }
            })
        }

        res_body = {
            PlayerInfo: PlayerInfo.response.players[0],
            OwnedGames: new_OwnedGames,
            games: games,
            achievements: achievements,
            playerAchievements: playerAchievements
        }
        res.send(res_body)

    } catch (error) {
        console.log(error.message)
        if (error.message == "Too Many Requests") { res.status(429).json({ error: error.message }); }
        else {res.status(500).json({ error: error.message });}
    }
});

app.listen(3000, () => console.log("Proxy server running on port 3000"));
