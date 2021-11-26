import mongoose from 'mongoose';
import axios from 'axios';
import dotenv from 'dotenv';
import schedule from 'node-schedule';
import inside from 'point-in-polygon';
import Redis from 'ioredis';


import AtcOnline from './models/AtcOnline.js';
import PilotOnline from './models/PilotOnline.js';
import Pireps from './models/Pireps.js';
import ControllerHours from './models/ControllerHours.js';

dotenv.config();

const redis = new Redis(process.env.REDIS_URI);

redis.on('error', err => { throw new Error(`Failed to connect to Redis: ${err}`); });
redis.on('connect', () => console.log('Successfully connected to Redis'));

const zabApi = axios.create({
	baseURL: process.env.ZAB_API_URL,
	headers: {
		'Authorization': `Bearer ${process.env.ZAB_API_KEY}`
	}
});

const atcPos = ["PHX", "ABQ", "TUS", "AMA", "ROW", "ELP", "SDL", "CHD", "FFZ", "IWA", "DVT", "GEU", "GYR", "LUF", "RYN", "DMA", "FLG", "PRC", "AEG", "BIF", "HMN", "SAF", "FHU"];
const airports = ["KPHX", "KABQ", "KTUS", "KAMA", "KROW", "KELP", "KSDL", "KCHD", "KFFZ", "KIWA", "KDVT", "KGEU", "KGYR", "KLUF", "KRYN", "KDMA", "KFLG", "KPRC", "KSEZ", "KAEG", "KBIF", "KHMN", "KSAF", "KFHU"];
const neighbors = ['LAX', 'DEN', 'KC', 'FTW', 'HOU', 'MMTY', 'MMTZ'];

const airspace = [
	[37.041667, -102.183333],
	[36.5, -101.75],
	[36.397222, -101.472222],
	[36.275, -101.133333],
	[35.9125, -100.211667],
	[35.829167, -100],
	[35.678611, -100],
	[35.333333, -100],
	[35.129167, -100.141667],
	[34.866667, -100.316667],
	[34.466667, -100.75],
	[34.491667, -101],
	[34.55, -101.541667],
	[34.6, -102],
	[34.55, -102.325],
	[34.388889, -102.6625],
	[34.316667, -102.8],
	[33.775, -103.366667],
	[33.6375, -103.4875],
	[33.402778, -103.691667],
	[33.383333, -103.8],
	[33.05, -103.8],
	[33, -103.8],
	[32.845833, -103.840278],
	[32.466667, -103.933333],
	[32.033333, -103.8],
	[31.808333, -103.529167],
	[31.65, -103.333333],
	[31.583333, -103.116667],
	[31.425, -102.216667],
	[31.283333, -102.15],
	[29.733611, -102.675556],
	[29.5225, -102.800556],
	[29.400278, -102.817222],
	[29.350278, -102.883889],
	[29.266944, -102.900556],
	[29.2225, -102.867222],
	[29.166944, -103.000556],
	[28.950278, -103.150556],
	[28.991944, -103.283889],
	[29.016944, -103.383889],
	[29.066944, -103.450556],
	[29.150278, -103.550556],
	[29.183611, -103.683889],
	[29.185278, -103.708889],
	[29.266944, -103.783889],
	[29.316944, -104.000556],
	[29.400278, -104.150556],
	[29.483611, -104.217222],
	[29.533611, -104.350556],
	[29.648333, -104.517778],
	[29.758611, -104.567222],
	[30.000278, -104.700556],
	[30.150278, -104.683889],
	[30.266667, -104.75],
	[30.366944, -104.833889],
	[30.550278, -104.900556],
	[30.600278, -104.967222],
	[30.683611, -104.983889],
	[30.683611, -105.050556],
	[30.787778, -105.200556],
	[30.833333, -105.317222],
	[31, -105.550556],
	[31.1, -105.650556],
	[31.166667, -105.783889],
	[31.283333, -105.883889],
	[31.341667, -105.951667],
	[31.383333, -106.000556],
	[31.466667, -106.200556],
	[31.666667, -106.333333],
	[31.733333, -106.383889],
	[31.75, -106.500556],
	[31.783333, -106.533889],
	[31.784335, -106.571657],
	[31.788324, -106.71252],
	[31.78947, -106.774294],
	[31.804254, -107.528889],
	[31.816667, -108.2],
	[31.333333, -108.2],
	[31.333333, -108.5],
	[31.333333, -109.352778],
	[31.333333, -110.75],
	[31.333307, -111.05],
	[31.333303, -111.100039],
	[31.368044, -111.186097],
	[31.516667, -111.641667],
	[31.633333, -112],
	[31.973719, -113.092358],
	[32.1, -113.508333],
	[32.7375, -113.684722],
	[32.683333, -114],
	[32.866667, -114],
	[33.083333, -114],
	[33.4, -114],
	[34.666667, -114],
	[34.916667, -113.616667],
	[35.379722, -112.666667],
	[35.417778, -112.153056],
	[35.438056, -112],
	[35.766667, -111.841667],
	[35.7, -110.233333],
	[35.85, -109.316667],
	[36.033333, -108.216667],
	[36.2, -107.466667],
	[36.626944, -106.35],
	[36.716667, -106.083333],
	[36.716667, -105.341667],
	[36.716667, -105],
	[37.045278, -104],
	[37.1625, -103.619444],
	[37.5, -102.55],
	[37.041667, -102.183333],
];

mongoose.set('toJSON', {virtuals: true});
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;
db.once('open', () => console.log('Successfully connected to MongoDB'));

const pollVatsim = async () => {
	await AtcOnline.deleteMany({}).exec();
	await PilotOnline.deleteMany({}).exec();
	
	console.log("Fetching data from VATSIM.");
	const {data} = await axios.get('https://data.vatsim.net/v3/vatsim-data.json');

	// PILOTS
	
	const dataPilots = [];
	
	let redisPilots = await redis.get('pilots');
	redisPilots = (redisPilots && redisPilots.length) ? redisPilots.split('|') : [];

	for(const pilot of data.pilots) { // Get all pilots that depart/arrive in ARTCC's airspace
		if(pilot.flight_plan !== null && (airports.includes(pilot.flight_plan.departure) || airports.includes(pilot.flight_plan.arrival) || inside([pilot.latitude, pilot.longitude], airspace))) {
			await PilotOnline.create({
				cid: pilot.cid,
				name: pilot.name,
				callsign: pilot.callsign,
				aircraft: pilot.flight_plan.aircraft_faa,
				dep: pilot.flight_plan.departure,
				dest: pilot.flight_plan.arrival,
				code: Math.floor(Math.random() * (999 - 101) + 101),
				lat: pilot.latitude,
				lng: pilot.longitude,
				altitude: pilot.altitude,
				heading: pilot.heading,
				speed: pilot.groundspeed,
				planned_cruise: pilot.flight_plan.altitude.includes("FL") ? (pilot.flight_plan.altitude.replace("FL", "") + '00') : pilot.flight_plan.altitude, // If flight plan altitude is 'FL350' instead of '35000'
				route: pilot.flight_plan.route,
				remarks: pilot.flight_plan.remarks
			});

			dataPilots.push(pilot.callsign);
			
			redis.hmset(`PILOT:${pilot.callsign}`,
				'callsign', pilot.callsign,
				'lat', `${pilot.latitude}`,
				'lng', `${pilot.longitude}`,
				'speed', `${pilot.groundspeed}`,
				'heading', `${pilot.heading}`,
				'altitude', `${pilot.altitude}`,
				'cruise', `${pilot.flight_plan.altitude.includes("FL") ? (pilot.flight_plan.altitude.replace("FL", "") + '00') : pilot.flight_plan.altitude}`,
				'destination', `${pilot.flight_plan.arrival}`,
			);
			redis.expire(`PILOT:${pilot.callsign}`, 300);
			redis.publish('PILOT:UPDATE', pilot.callsign);

		}
	}

	for(const pilot of redisPilots) {
		if(!dataPilots.includes(pilot)) {
			redis.publish('PILOT:DELETE', pilot);
		}
	}

	redis.set('pilots', dataPilots.join('|'));
	redis.expire(`pilots`, 65);
	
	// CONTROLLERS
	const dataControllers = [];
	let redisControllers = await redis.get('controllers');
	redisControllers = (redisControllers && redisControllers.length) ? redisControllers.split('|') : [];

	const dataNeighbors = [];

	for(const controller of data.controllers) { // Get all controllers that are online in ARTCC's airspace
		if(atcPos.includes(controller.callsign.slice(0, 3)) && controller.callsign !== "PRC_FSS" && controller.facility !== 0) {
			await AtcOnline.create({
				cid: controller.cid,
				name: controller.name,
				rating: controller.rating,
				pos: controller.callsign,
				timeStart: controller.logon_time,
				atis: controller.text_atis ? controller.text_atis.join(' - ') : '',
				frequency: controller.frequency
			});

			dataControllers.push(controller.callsign);
	
			const session = await ControllerHours.findOne({
				cid: controller.cid,
				timeStart: controller.logon_time
			});
	
			if(!session) {
				await ControllerHours.create({
					cid: controller.cid,
					timeStart: controller.logon_time,
					timeEnd: new Date(new Date().toUTCString()),
					position: controller.callsign
				});
				await zabApi.post(`/stats/fifty/${controller.cid}`);
			} else {
				session.timeEnd = new Date(new Date().toUTCString());
				await session.save();
			}
		}
		const callsignParts = controller.callsign.split('_');
		if(neighbors.includes(callsignParts[0]) && callsignParts[callsignParts.length - 1] === "CTR") { // neighboring center
			dataNeighbors.push(callsignParts[0]);
		}
	}

	for(const atc of redisControllers) {
		if(!dataControllers.includes(atc)) {
			redis.publish('CONTROLLER:DELETE', atc);
		}
	}

	redis.set('controllers', dataControllers.join('|'));
	redis.expire(`controllers`, 65);
	redis.set('neighbors', dataNeighbors.join('|'));
	redis.expire(`neighbors`, 65);

	// METARS

	const airportsString = airports.join(","); // Get all METARs, add to database
	const response = await axios.get(`https://metar.vatsim.net/${airportsString}`);
	const metars = response.data.split("\n");

	for(const metar of metars) {
		redis.set(`METAR:${metar.slice(0,4)}`, metar);
	}

	// ATIS

	const dataAtis = [];
	let redisAtis = await redis.get('atis');
	redisAtis = (redisAtis && redisAtis.length) ? redisAtis.split('|') : [];

	for(const atis of data.atis) { // Find all ATIS connections within ARTCC's airspace
		const airport = atis.callsign.slice(0,4);
		if(airports.includes(airport)) {
			dataAtis.push(airport);
			redis.expire(`ATIS:${airport}`, 65);
		}
	}

	for(const atis of redisAtis) {
		if(!dataAtis.includes(atis)) {
			redis.publish('ATIS:DELETE', atis);
			redis.del(`ATIS:${atis}`);
		}
	}

	redis.set('atis', dataAtis.join('|'));
	redis.expire(`atis`, 65);
};

const getPireps = async () => {
	console.log('Fetching PIREPs.');
	let twoHours = new Date();
	twoHours = new Date(twoHours.setHours(twoHours.getHours() - 2));

	await Pireps.deleteMany({$or: [{manual: false}, {reportTime: {$lte: twoHours}}]}).exec();

	const pirepsJson = await axios.get('https://www.aviationweather.gov/cgi-bin/json/AirepJSON.php');
	const pireps = pirepsJson.data.features;
	for(const pirep of pireps) {
		if((pirep.properties.airepType === 'PIREP' || pirep.properties.airepType === 'Urgent PIREP') && inside(pirep.geometry.coordinates.reverse(), airspace) === true) { // Why do you put the coordinates the wrong way around, FAA? WHY?
			const wind = `${(pirep.properties.wdir ? pirep.properties.wdir : '')}${pirep.properties.wspd ? '@' + pirep.properties.wspd : ''}`;
			const icing = ((pirep.properties.icgInt1 ? pirep.properties.icgInt1 + ' ' : '') + (pirep.properties.icgType1 ? pirep.properties.icgType1 : '')).replace(/\s+/g,' ').trim();
			const skyCond = (pirep.properties.cloudCvg1 ? pirep.properties.cloudCvg1 + ' ' : '') + ( pirep.properties.Bas1 ? ('000' + pirep.properties.Bas1).slice(-3) : '') + (pirep.properties.Top1 ? '-' + ('000' + pirep.properties.Top1).slice(-3) : '');
			const turbulence = (pirep.properties.tbInt1 ? pirep.properties.tbInt1 + ' ' : '') + (pirep.properties.tbFreq1 ? pirep.properties.tbFreq1 + ' ' : '') + (pirep.properties.tbType1 ? pirep.properties.tbType1 : '').replace(/\s+/g,' ').trim();
			try {
				await Pireps.create({
					reportTime: pirep.properties.obsTime || '',
					location: pirep.properties.rawOb.slice(0,3) || '',
					aircraft: pirep.properties.acType || '',
					flightLevel: pirep.properties.fltlvl || '',
					skyCond: skyCond,
					turbulence: turbulence,
					icing: icing,
					vis: pirep.visibility_statute_mi ? pirep.visibility_statute_mi._text : '',
					temp: pirep.properties.temp ? pirep.properties.temp : '',
					wind: wind,
					urgent: pirep.properties.airepType === 'Urgent PIREP' ? true : false,
					raw: pirep.properties.rawOb,
					manual: false
				});
			} catch(e) {
				console.log(e);
			}
		}
	}
};


(async () =>{
	await redis.set('airports', airports.join('|'));
	await pollVatsim();
	await getPireps();
	schedule.scheduleJob('*/15 * * * * *', pollVatsim); // run every 15 seconds
	schedule.scheduleJob('*/2 * * * *', getPireps); // run every 2 minutes
})();

	

	

//https://www.aviationweather.gov/adds/dataserver_current/httpparam?dataSource=aircraftreports&requestType=retrieve&format=xml&minLat=30&minLon=-113&maxLat=37&maxLon=-100&hoursBeforeNow=2
//https://www.aviationweather.gov/cgi-bin/json/AirepJSON.php