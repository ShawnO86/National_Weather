import express from "express";
import cors from 'cors';
import { getGeoData } from "../utils/weatherJson.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// host/weather/city(optional)/lat(optional)/long(optional)
app.get('/getData:city?/:lat?/:long?', async (req, res) => {
    try {
        const weatherData = await getGeoData(req.params.city, req.params.lat, req.params.long);
        res.send(weatherData);
    } catch (e) {
        console.log("Geo error", e);
        res.status(500).send('Internal Server Error');
    }
});
export default app;