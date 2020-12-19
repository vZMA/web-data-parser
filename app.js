import mongoose from 'mongoose';
import axios from 'axios';
import dotenv from 'dotenv'
import schedule from 'node-schedule';
import moment from 'moment';
import AtcOnline from './models/AtcOnline.js';
import PilotOnline from './models/PilotOnline.js';
import ControllerHours from './models/ControllerHours.js';

dotenv.config();

const atcPos = ["PHX", "ABQ", "TUS", "AMA", "ROW", "ELP", "SDL", "CHD", "FFZ", "IWA", "DVT", "GEU", "GYR", "LUF", "RYN", "DMA", "FLG", "PRC", "AEG", "BIF", "HMN", "SAF", "FHU"];
const airports = ["KPHX", "KABQ", "KTUS", "KAMA", "KROW", "KELP", "KSDL", "KCHD", "KFFZ", "KIWA", "KDVT", "KGEU", "KGYR", "KLUF", "KRYN", "KDMA", "KFLG", "KPRC", "KAEG", "KBIF", "KHMN", "KSAF", "KFHU"];

mongoose.set('toJSON', {virtuals: true});
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useCreateIndex: true, useUnifiedTopology: true });
const db = mongoose.connection;
db.once('open', () => console.log('Successfully connected to MongoDB'));

schedule.scheduleJob('*/2 * * * *', async () => { // run every 2 minutes
	await AtcOnline.deleteMany({}).exec();
	await PilotOnline.deleteMany({}).exec();
	console.log("Fetching data from VATISM.")
	
	const {data} = await axios.get('https://data.vatsim.net/v3/vatsim-data.json');

	for(const pilot of data.pilots) {
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
		}
	};

	for(const controller of data.controllers) {
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
	};


});