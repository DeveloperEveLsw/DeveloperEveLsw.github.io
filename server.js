const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors()); 

app.get("/api", async (req, res) => {
    try {
        const apiKey = req.query.apiKey
        const steamId = req.query.steamId

        if (!(steamId || apiKey)) { 
            return res.status(400).json({
                error: "Missing required query parameters",
                message: "Please provide both 'steamId' or 'apiKey' in the query string.",
                example: "/api?steamId=yourSteamId&apiKey=yourApiKey"
        });
         }

        const PlayerInfo = await fetch(
            `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`
        ).then( (e)=>e.json() );

        console.log(JSON.stringify(PlayerInfo))

        const OwnedGames = await fetch(
            `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`
        ).then( (e)=>e.json() );

        console.log(JSON.stringify(OwnedGames))

        let appids = OwnedGames.response.games.map(game => game.appid);

        const games = await Promise.all(
            appids.map(async appid => {
                const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=price_overview,release_date`)
                return res.json()
            })
        )
        const filteredData = games.filter(item => {
            const key = Object.keys(item)[0]; // 객체에서 키 추출
            return item[key].success === true; // success가 true인지 확인
        });

        console.log(JSON.stringify(filteredData))

        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => console.log("Proxy server running on port 3000"));
