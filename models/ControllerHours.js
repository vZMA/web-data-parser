import m from 'mongoose';

const controllerHoursSchema = new m.Schema({
    cid: Number,
    timeStart: Date,
    timeEnd: Date,
    pos: String
}, {
    collection: "controllerHours"
})

export default m.model('ControllerHours', controllerHoursSchema);