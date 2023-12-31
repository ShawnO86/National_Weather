import fetch from "node-fetch";
import dotenv from 'dotenv';
import WeatherData from './weatherData.js';
import { cToF, get12HourFormat, dateFormat, hourFormat, removeTime, separateByDate, extractHourlyBaseURL, extractDailyBaseURL } from './weatherUtils.js'

dotenv.config();
const geoKey = process.env.geonames_key;
const aqiKey = process.env.aqi_key;
const projectData = new WeatherData();

//main function to return filled in weatherData object to send to client
export const getGeoData = async (city, lat, long) => {
    //city can be "city,state" or zip
    let geoData = '';
    console.log(geoKey)
    if (city !== 'no') {
        geoData = await fetch(`http://api.geonames.org/searchJSON?q=${city}&radius=10&maxRows=1&country=US&username=${geoKey}`);
        try {
            const data = await geoData.json();
            //filtering for only United States zipcode data
            const filteredData = data.geonames.filter(item => item.countryCode === "US");
            //console.log("filtered: ", filteredData)
            //populate weatherData with api data
            projectData.zoneData.long = filteredData[0].lng;
            projectData.zoneData.lat = filteredData[0].lat;
            projectData.zoneData.country = filteredData[0].countryCode;
            projectData.zoneData.local = filteredData[0].adminName1;
            projectData.zoneData.name = filteredData[0].name;
            await getZoneData();
        } catch (e) {
            console.log("Geo search data error", e);
        }
    }
    else if (lat !== 'no' && long !== 'no') {
        geoData = await fetch(`http://api.geonames.org/findNearbyPostalCodesJSON?lat=${lat}&lng=${long}&radius=10&maxRows=1&country=US&username=${geoKey}`);
        try {
            const data = await geoData.json();
            //console.log(data)
            //populate weatherData with api data
            projectData.zoneData.long = data.postalCodes[0].lng;
            projectData.zoneData.lat = data.postalCodes[0].lat;
            projectData.zoneData.country = data.postalCodes[0].countryCode;
            projectData.zoneData.local = data.postalCodes[0].adminName1;
            projectData.zoneData.name = data.postalCodes[0].placeName;
            await getZoneData();
        } catch (e) {
            console.log("Geo postal data error", e);
        }
    }
    return projectData;
};

//gets urls for forcasts, zone data, and County info for the following functions
const getZoneData = async () => {
    const getForcastURL = await fetch(`https://api.weather.gov/points/${projectData.zoneData.lat},${projectData.zoneData.long}`);
    const zoneId = await fetch(`https://api.weather.gov/zones/county?point=${projectData.zoneData.lat},${projectData.zoneData.long}`);
    try {
        const urlJson = await getForcastURL.json();
        const zoneJson = await zoneId.json();
        projectData.zoneData.dailyForecastURL = urlJson.properties.forecast;
        projectData.zoneData.hourlyForecastURL = urlJson.properties.forecastHourly;
        projectData.zoneData.zoneId = zoneJson.features[0].properties.id;
        projectData.zoneData.county = zoneJson.features[0].properties.name;

        await getDailyForcastData(projectData.zoneData.dailyForecastURL)
        await getHourlyForcastData(projectData.zoneData.hourlyForecastURL);
        await getAlertData(projectData.zoneData.zoneId);
    } catch (e) {
        console.log("forecast URL error:", e);
    }
};

const getAstroData = async (date) => {
    const astroURL = await fetch(`https://api.sunrise-sunset.org/json?lat=${projectData.zoneData.lat}&lng=${projectData.zoneData.long}&date=${date}&formatted=0`);
    try {
        const astroData = await astroURL.json();
        const sunrise = astroData.results.sunrise;
        const sunset = astroData.results.sunset;
        return { sunrise: sunrise, sunset: sunset }
    } catch (e) {
        console.log("Astro data error: ", e);
    }
};
const maxTries = 3; //max number to retry the weather api calls
//weather.gov api documentation states - The gridpoints endpoint returns a 500 error. Retrying the request generally returns valid data.
const getDailyForcastData = async (url, retryCount = 0) => {
    const forecast = [];
    try {
        const forcastURL = await fetch(url);
        const forcastData = await forcastURL.json();
        //console.log(forcastData.properties.periods)
        for (const day of forcastData.properties.periods) {
            forecast.push({
                name: day.name,
                date: dateFormat(day.startTime),
                isDaytime: day.isDaytime,
                astro: day.isDaytime == true ? await getAstroData(removeTime(day.startTime)) : "",
                temp: day.temperature + day.temperatureUnit,
                precip: day.probabilityOfPrecipitation.value == null ? 0 + '%' : day.probabilityOfPrecipitation.value + '%',
                dewpoint: cToF(day.dewpoint.value) + "F",
                humidity: day.relativeHumidity.value + "%",
                windSpeed: day.windSpeed,
                windDirection: day.windDirection,
                shortDesc: day.shortForecast,
                detailDesc: day.detailedForecast,
                icon: extractDailyBaseURL(day.icon)
            })
        };
        projectData.weatherData.dateUpdated = removeTime(forcastData.properties.updated);
        projectData.weatherData.dailyForecast = separateByDate(forecast);
        await getAirQuality(projectData.zoneData.lat, projectData.zoneData.long, projectData.weatherData.dateUpdated);
    } catch (e) {
        console.log(`Daily Forecast data error: ${e} - Retrying.. `);
        if (retryCount < maxTries) {
            setTimeout(async () => {
                await getDailyForcastData(url, retryCount + 1)
            }, 200)
        } else {
            console.log("Maximum retries used! Unable to fetch daily forecast.")
        }
    }
};

const getHourlyForcastData = async (url, retryCount = 0) => {
    const forecastArr = [];
    try {
        const forcastURL = await fetch(url);
        const forcastData = await forcastURL.json()
        for (const hour of forcastData.properties.periods) {
            forecastArr.push({
                date: dateFormat(hour.startTime),
                time: hourFormat(hour.startTime),
                isDaytime: hour.isDaytime,
                temp: hour.temperature + hour.temperatureUnit,
                precip: hour.probabilityOfPrecipitation.value == null ? 0 + '%' : hour.probabilityOfPrecipitation.value + '%',
                humidity: hour.relativeHumidity.value + "%",
                windSpeed: hour.windSpeed,
                windDirection: hour.windDirection,
                shortDesc: hour.shortForecast,
                icon: extractHourlyBaseURL(hour.icon)
            })
        }
        //sliced out only the first 48 hours of the Hourly Forcast Data
        projectData.weatherData.hourlyForecast = separateByDate(forecastArr.slice(0, 49));
    } catch (e) {
        console.log(`Hourly Forecast data error: ${e} - Retrying.. `);
        if (retryCount < maxTries) {
            setTimeout(async () => {
                await getHourlyForcastData(url, retryCount + 1)
            }, 200)
        } else {
            console.log("Maximum retries used! Unable to fetch hourly forecast.")
        }
    }
};

const getAirQuality = async (lat, long, date) => {
    const currentAqiArr = [];
    const forcastAqiArr = [];
    try {
        const current_aqiURL = await fetch(`https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${long}&distance=50&API_KEY=${aqiKey}`);
        const forcast_aqiURL = await fetch(`https://www.airnowapi.org/aq/forecast/latLong/?format=application/json&latitude=${lat}&longitude=${long}&date=${date}&distance=25&API_KEY=${aqiKey}`);
        const aqiData = await current_aqiURL.json();
        const forcastAqiData = await forcast_aqiURL.json();
        for (const result of aqiData) {
            currentAqiArr.push({
                hour: get12HourFormat(result.HourObserved),
                type: result.ParameterName === "O3" ? "Ozone" : result.ParameterName,
                value: result.AQI,
                categoryValue: result.Category.Number,
                categoryDesc: result.Category.Name
            })
        };
        for (const result of forcastAqiData) {
            forcastAqiArr.push({
                date: dateFormat(result.DateForecast),
                type: result.ParameterName === "O3" ? "Ozone" : result.ParameterName,
                categoryValue: result.Category.Number,
                categoryDesc: result.Category.Name
            })
        };
        projectData.weatherData.airQualityCurrent = currentAqiArr;
        projectData.weatherData.airQualityForecast = forcastAqiArr;
    } catch (e) {
        console.log("AQI data error: ", e);
    }
};

const getAlertData = async (zone) => {
    const alertURL = await fetch(`https://api.weather.gov/alerts/active?zone=${zone}`);
    let alertArr = [];
    try {
        const alertData = await alertURL.json();
        alertData.features.forEach(alertItem => {
            alertArr.push({
                alertHeadline: alertItem.properties.headline,
                alertAreas: "The Following Counties are Affected: " + alertItem.properties.areaDesc,
                alertTextDesc: alertItem.properties.description,
                alertStartTime: alertItem.properties.effective,
                alertEndTime: alertItem.properties.expires,
            })
        })
        projectData.weatherData.alerts = alertArr;
    } catch (e) {
        console.log("Alert Data error: ", e);
    }
};