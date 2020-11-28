import mongoose from 'mongoose';
import fetch from 'node-fetch';
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
	
	const res = await fetch('http://cluster.data.vatsim.net/vatsim-data.json');
	const data = await res.json();
	
	for(const client of data.clients) {
		if(client.clienttype === "ATC" && atcPos.includes(client.callsign.slice(0, 3)) && client.callsign !== "PRC_FSS") {
			await AtcOnline.create({
				cid: client.cid,
				name: client.realname,
				rating: client.rating,
				pos: client.callsign,
				timeStart: client.time_logon,
				atis: client.atis_message,
				frequency: client.frequency
			})
	
			const session = await ControllerHours.findOne({
				cid: client.cid,
				timeStart: client.time_logon
			})
	
			if(!session) {
				await ControllerHours.create({
					cid: client.cid,
					timeStart: client.time_logon,
					timeEnd: moment().utc(),
					position: client.callsign
				})
			} else {
				session.timeEnd = moment().utc();
				await session.save();
			}
		}
		if(client.clienttype === "PILOT" && (airports.includes(client.planned_depairport) || airports.includes(client.planned_destairport))) {
			await PilotOnline.create({
				cid: client.cid,
				name: client.realname,
				callsign: client.callsign,
				aircraft: client.planned_aircraft.substring(0, 8),
				dep: client.planned_depairport,
				dest: client.planned_destairport,
				lat: client.latitude,
				lng: client.longitude,
				heading: client.heading,
				route: client.planned_route,
				remarks: client.planned_remarks
			})
		}
	}
})