import mongoose from 'mongoose';
import axios from 'axios';
import dotenv from 'dotenv'
import schedule from 'node-schedule';
import convert from 'xml-js';
import moment from 'moment';
import Redis from 'ioredis';
import AtcOnline from './models/AtcOnline.js';
import AtisOnline from './models/AtisOnline.js';
import PilotOnline from './models/PilotOnline.js';
import Pireps from './models/Pireps.js';
import ControllerHours from './models/ControllerHours.js';

mongoose.set('useFindAndModify', false);

dotenv.config();

const redis = new Redis(process.env.REDIS_URI);

const atcPos = ["PHX", "ABQ", "TUS", "AMA", "ROW", "ELP", "SDL", "CHD", "FFZ", "IWA", "DVT", "GEU", "GYR", "LUF", "RYN", "DMA", "FLG", "PRC", "AEG", "BIF", "HMN", "SAF", "FHU"];
const airports = ["KPHX", "KABQ", "KTUS", "KAMA", "KROW", "KELP", "KSDL", "KCHD", "KFFZ", "KIWA", "KDVT", "KGEU", "KGYR", "KLUF", "KRYN", "KDMA", "KFLG", "KPRC", "KAEG", "KBIF", "KHMN", "KSAF", "KFHU"];
const neighbors = ['LAX', 'DEN', 'KC', 'FTW', 'HOU', 'MMTY', 'MMTZ'];


mongoose.set('toJSON', {virtuals: true});
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useCreateIndex: true, useUnifiedTopology: true });
const db = mongoose.connection;
db.once('open', () => console.log('Successfully connected to MongoDB'));

const pollVatsim = async () => {
	await AtcOnline.deleteMany({}).exec();
	await PilotOnline.deleteMany({}).exec();
	await AtisOnline.deleteMany({}).exec();
	let twoHours = new Date();
	twoHours = new Date(twoHours.setHours(twoHours.getHours() - 2));
	await Pireps.deleteMany({$or: [{manual: false}, {reportTime: {$lte: twoHours}}]}).exec();
	console.log("Fetching data from VATISM.")
	const {data} = await axios.get('https://data.vatsim.net/v3/vatsim-data.json');

	// PILOTS
	
	const dataPilots = [];
	
	let redisPilots = await redis.get('pilots');
	redisPilots = (redisPilots && redisPilots.length) ? redisPilots.split('|') : [];

	for(const pilot of data.pilots) { // Get all pilots that depart/arrive in ARTCC's airspace
		if(pilot.flight_plan !== null && (airports.includes(pilot.flight_plan.departure) || airports.includes(pilot.flight_plan.arrival))) {
			await PilotOnline.create({
				cid: pilot.cid,
				name: pilot.name,
				callsign: pilot.callsign,
				aircraft: pilot.flight_plan.aircraft.substring(0, 8),
				dep: pilot.flight_plan.departure,
				dest: pilot.flight_plan.arrival,
				lat: pilot.latitude,
				lng: pilot.longitude,
				altitude: pilot.altitude,
				heading: pilot.heading,
				speed: pilot.groundspeed,
				planned_cruise: pilot.flight_plan.altitude,
				route: pilot.flight_plan.route,
				remarks: pilot.flight_plan.remarks
			});
			dataPilots.push(pilot.callsign);
			
			redis.hmset(`PILOT:${pilot.callsign}`,
				'callsign', pilot.callsign,
				'lat',  `${pilot.latitude}`,
				'lng',  `${pilot.longitude}`,
				'speed', `${pilot.groundspeed}`,
				'heading', `${pilot.heading}`,
				'altitude', `${pilot.altitude}`,
				'cruise', `${pilot.flight_plan.altitude}`,
				'destination', `${pilot.flight_plan.arrival}`,
			);
			redis.publish('PILOT:UPDATE', pilot.callsign)
		}
	};

	for(const pilot of redisPilots) {
		if(!dataPilots.includes(pilot)) {
			redis.publish('PILOT:DELETE', pilot)
		}
	}

	redis.set('pilots', dataPilots.join('|'));
	redis.expire(`pilots`, 65);
	
	// CONTROLLERS
	const dataControllers = [];
	let redisControllers = await redis.get('controllers');
	redisControllers = (redisControllers && redisControllers.length) ? redisControllers.split('|') : [];

	const dataNeighbors = [];
	let redisNeighbors = await redis.get('neighbors');
	redisNeighbors = (redisNeighbors && redisNeighbors.length) ? redisNeighbors.split('|') : [];

	for(const controller of data.controllers) { // Get all controllers that are online in ARTCC's airspace
		if(atcPos.includes(controller.callsign.slice(0, 3)) && controller.callsign !== "PRC_FSS") {
			await AtcOnline.create({
				cid: controller.cid,
				name: controller.name,
				rating: controller.rating,
				pos: controller.callsign,
				timeStart: controller.logon_time,
				atis: controller.text_atis ? controller.text_atis.join(' - ') : '',
				frequency: controller.frequency
			})

			dataControllers.push(controller.callsign);
	
			const session = await ControllerHours.findOne({
				cid: controller.cid,
				timeStart: controller.logon_time
			})
	
			if(!session) {
				await ControllerHours.create({
					cid: controller.cid,
					timeStart: controller.logon_time,
					timeEnd: moment().utc(),
					position: controller.callsign
				})
			} else {
				session.timeEnd = moment().utc();
				await session.save();
			}
		}
		const callsignParts = controller.callsign.split('_');
		if(neighbors.includes(callsignParts[0]) && callsignParts[callsignParts.length - 1] === "CTR") { // neighboring center
			dataNeighbors.push(callsignParts[0])
		}
	};

	for(const atc of redisControllers) {
		if(!dataControllers.includes(atc)) {
			redis.publish('CONTROLLER:DELETE', atc)
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
		await AtisOnline.create({
			airport: metar.slice(0,4),
			metar: metar
		});
		redis.set(`METAR:${metar.slice(0,4)}`, metar);
	}

	// ATIS

	const dataAtis = []
	let redisAtis = await redis.get('atis')
	redisAtis = (redisAtis && redisAtis.length) ? redisAtis.split('|') : [];

	for(const atis of data.atis) { // Find all ATIS connections within ARTCC's airspace
		const airport = atis.callsign.slice(0,4)
		if(airports.includes(airport)) {
			dataAtis.push(airport);
			redis.expire(`ATIS:${airport}`, 65)
		}
	}

	for(const atis of redisAtis) {
		if(!dataAtis.includes(atis)) {
			redis.publish('ATIS:DELETE', atis)
			redis.del(`ATIS:${atis}`);
		}
	}

	redis.set('atis', dataAtis.join('|'));
	redis.expire(`atis`, 65);
}

const getPireps = async () => {
	const pirepsXml = await axios.get('https://www.aviationweather.gov/adds/dataserver_current/httpparam?dataSource=aircraftreports&requestType=retrieve&format=xml&minLat=30&minLon=-113&maxLat=37&maxLon=-100&hoursBeforeNow=2');
	const pirepsJson = JSON.parse(convert.xml2json(pirepsXml.data, {compact: true, spaces: 4}));
	if(pirepsJson.response.data.AircraftReport && pirepsJson.response.data.AircraftReport.isArray !== true) {
		const pirep = pirepsJson.response.data.AircraftReport;
		if(pirep.report_type && pirep.report_type._text === 'PIREP') {
			const windDir = pirep.wind_dir_degrees ? pirep.wind_dir_degrees._text : '';
			const windSpd =  pirep.wind_speed_kt ? pirep.wind_speed_kt._text : '';
			const wind = `${windDir}@${windSpd}`;
			const altitude = pirep.altitude_ft_msl ? ((pirep.altitude_ft_msl._text).slice(0, -2).length > 2 ? (pirep.altitude_ft_msl._text).slice(0, -2) : ('0' + pirep.altitude_ft_msl._text).slice(0, -2)) : '';
			await Pireps.create({
				reportTime: pirep.observation_time._text,
				aircraft: pirep.aircraft_ref._text,
				flightLevel: altitude,
				skyCond: pirep.sky_condition ? `${pirep.sky_condition._attributes.sky_cover} ${pirep.sky_condition._attributes.cloud_base_ft_msl ? pirep.sky_condition._attributes.cloud_base_ft_msl : ''}${pirep.sky_condition._attributes.cloud_top_ft_msl ? '- ' + pirep.sky_condition._attributes.cloud_top_ft_msl : ''}` : '',
				turbulence: pirep.turbulence_condition ? pirep.turbulence_condition._attributes.turbulence_intensity : '',
				icing: pirep.icing_condition ? `${pirep.icing_condition._attributes.icing_intensity.slice(0,3)} ${('0' + pirep.icing_condition._attributes.icing_base_ft_msl).slice(0,-2)}${pirep.icing_condition._attributes.icing_top_ft_msl ? '-' + pirep.icing_condition._attributes.icing_top_ft_msl : ''}` : '',
				vis: pirep.visibility_statute_mi ? pirep.visibility_statute_mi._text : '',
				temp: pirep.temp_c ? pirep.temp_c._text : '',
				wind: wind,
				urgent: pirep.report_type._text === 'Urgent PIREP' ? true : false,
				raw: pirep.raw_text._text,
				manual: false
			});
		}
	} else if(pirepsJson.response.data.AircraftReport && pirepsJson.response.data.AircraftReport) {
		for(const pirep of pirepsJson.response.data.AircraftReport.isArray === true) {
			if(pirep.report_type._text === 'PIREP') {
				const windDir = pirep.wind_dir_degrees ? pirep.wind_dir_degrees._text : '';
				const windSpd =  pirep.wind_speed_kt ? pirep.wind_speed_kt._text : '';
				const wind = `${windDir}@${windSpd}`;
				const altitude = pirep.altitude_ft_msl ? ((pirep.altitude_ft_msl._text).slice(0, -2).length > 2 ? (pirep.altitude_ft_msl._text).slice(0, -2) : ('0' + pirep.altitude_ft_msl._text).slice(0, -2)) : '';

				await Pireps.create({
					reportTime: pirep.observation_time._text,
					aircraft: pirep.aircraft_ref._text,
					flightLevel: altitude,
					skyCond: pirep.sky_condition ? `${pirep.sky_condition._attributes.sky_cover} ${pirep.sky_condition._attributes.cloud_base_ft_msl}-${pirep.sky_condition._attributes.cloud_top_ft_msl}` : '',
					turbulence: pirep.turbulence_condition ? pirep.turbulence_condition._attributes.turbulence_intensity : '',
					icing: pirep.icing_condition ? `${pirep.icing_condition._attributes.icing_intensity.slice(0,3)} ${pirep.icing_condition._attributes.icing_base_ft_msl.slice(-2)}-${pirep.icing_condition._attributes.icing_top_ft_msl}` : '',
					vis: pirep.visibility_statute_mi ? pirep.visibility_statute_mi._text : '',
					temp: pirep.temp_c ? pirep.temp_c._text : '',
					wind: wind,
					urgent: pirep.report_type._text === 'Urgent PIREP' ? true : false,
					raw: pirep.raw_text._text,
					manual: false
				});
			}
		}
	}
}


(async () =>{
	redis.set('airports', airports.join('|'));
	await pollVatsim();
	await getPireps();
	schedule.scheduleJob('* * * * *', pollVatsim) // run every minute
	schedule.scheduleJob('*/2 * * * *', getPireps) // run every 2 minutes
})();

	

	

//https://www.aviationweather.gov/adds/dataserver_current/httpparam?dataSource=aircraftreports&requestType=retrieve&format=xml&minLat=30&minLon=-113&maxLat=37&maxLon=-100&hoursBeforeNow=2