const warema = require('warema-wms-venetian-blinds');
var mqtt = require('mqtt')

process.on('SIGINT', function () {
  process.exit(0);
});

const ignoredDevices = process.env.IGNORED_DEVICES ? process.env.IGNORED_DEVICES.split(',') : []
// const forceDevices = process.env.FORCE_DEVICES ? process.env.FORCE_DEVICES.split(',') : []

const forceDevices = [
  {
    "snr": 1448309,
    "type": 20
  }
]

const weatherDataPushIntervall = process.env.WEATHER_PUSH_INTERVALL || 600
const hassTopicPrefix = process.env.HASS_TOPIC_PREFIX || 'homeassistant'

const settingsPar = {
  wmsChannel: process.env.WMS_CHANNEL || 17,
  wmsKey: process.env.WMS_KEY || '00112233445566778899AABBCCDDEEFF',
  wmsPanid: process.env.WMS_PAN_ID || 'FFFF',
  wmsSerialPort: process.env.WMS_SERIAL_PORT || '/dev/ttyUSB0',
};

var weatherFirstPushed = false
var registered_shades = []
var shade_position = []
var last_weather_data_published = new Date(0);

function registerDevice(element) {
  console.log('Registering ' + element.snr)
  var topic = hassTopicPrefix + '/cover/' + element.snr + '/' + element.snr + '/config'
  var availability_topic = 'warema/' + element.snr + '/availability'

  var base_payload = {
    name: element.snr,
    availability: [
      { topic: 'warema/bridge/state' },
      { topic: availability_topic }
    ],
    unique_id: element.snr
  }

  var base_device = {
    identifiers: element.snr,
    manufacturer: "Warema",
    name: element.snr
  }

  var model
  var payload
  switch (parseInt(element.type)) {
    case 6:
      model = 'Weather station'
      payload = {
        ...base_payload,
        device: {
          ...base_device,
          model: model
        }
      }
      break
    // WMS WebControl Pro - while part of the network, we have no business to do with it.
    case 9:
      return
    case 20:
      model = 'Plug receiver'
      payload = {
        ...base_payload,
        name: 'receiver',
        device: {
          ...base_device,
          model: model
        },
        position_open: 0,
        position_closed: 100,
        command_topic: 'warema/' + element.snr + '/set',
        position_topic: 'warema/' + element.snr + '/position',
        //tilt_status_topic: 'warema/' + element.snr + '/tilt',
        set_position_topic: 'warema/' + element.snr + '/set_position',
        //tilt_command_topic: 'warema/' + element.snr + '/set_tilt',
        //tilt_closed_value: -100,
        //tilt_opened_value: 100,
        //tilt_min: -100,
        //tilt_max: 100,
      }
      break
    case 21:
      model = 'Actuator UP'
      payload = {
        ...base_payload,
        device: {
          ...base_device,
          model: model
        },
        position_open: 0,
        position_closed: 100,
        command_topic: 'warema/' + element.snr + '/set',
        position_topic: 'warema/' + element.snr + '/position',
        tilt_status_topic: 'warema/' + element.snr + '/tilt',
        set_position_topic: 'warema/' + element.snr + '/set_position',
        tilt_command_topic: 'warema/' + element.snr + '/set_tilt',
        tilt_closed_value: -100,
        tilt_opened_value: 100,
        tilt_min: -100,
        tilt_max: 100,
      }
      break
    case 25:
      model = 'Vertical awning'
      payload = {
        ...base_payload,
        device: {
          ...base_device,
          model: model
        },
        position_open: 0,
        position_closed: 100,
        command_topic: 'warema/' + element.snr + '/set',
        position_topic: 'warema/' + element.snr + '/position',
        set_position_topic: 'warema/' + element.snr + '/set_position',
      }
      break
    default:
      console.log('Unrecognized device type: ' + element.type)
      model = 'Unknown model ' + element.type
      return
  }

  if (ignoredDevices.includes(element.snr.toString())) {
    console.log('Ignoring and removing device ' + element.snr + ' (type ' + element.type + ')')
  } else {
    console.log('Adding device ' + element.snr + ' (type ' + element.type + ')')

    stickUsb.vnBlindAdd(parseInt(element.snr), element.snr.toString());
    registered_shades += element.snr
    client.publish(availability_topic, 'online', { retain: true })
  }
  client.publish(topic, JSON.stringify(payload))
}

function registerDevices() {
  console.log('Registering devices')
  if (forceDevices && forceDevices.length) {
    forceDevices.forEach(element => {
      registerDevice(element)
    })
  } else {
    console.log('Scanning...')
    stickUsb.scanDevices({ autoAssignBlinds: false });
  }
}

function timeToPublishWeatherData() {
  return ((new Date().getTime() - last_weather_data_published.getTime()) / 1000) > weatherDataPushIntervall || weatherFirstPushed == false
}

function handleWeatherBroadcast(msg) {

  if (registered_shades.includes(msg.payload.weather.snr)) {
    if (timeToPublishWeatherData()) {
      client.publish('warema/' + msg.payload.weather.snr + '/illuminance/state', msg.payload.weather.lumen.toString())
      client.publish('warema/' + msg.payload.weather.snr + '/temperature/state', msg.payload.weather.temp.toString())
      client.publish('warema/' + msg.payload.weather.snr + '/wind/state', msg.payload.weather.wind.toString())
      last_weather_data_published = new Date()
      weatherFirstPushed = true;
    }
  } else {
    var availability_topic = 'warema/' + msg.payload.weather.snr + '/availability'
    var payload = {
      name: msg.payload.weather.snr,
      availability: [
        { topic: 'warema/bridge/state' },
        { topic: availability_topic }
      ],
      device: {
        identifiers: msg.payload.weather.snr,
        manufacturer: 'Warema',
        model: 'Weather Station',
        name: msg.payload.weather.snr
      },
      force_update: true
    }

    var illuminance_payload = {
      ...payload,
      state_topic: 'warema/' + msg.payload.weather.snr + '/illuminance/state',
      device_class: 'illuminance',
      name: 'illuminance',
      unique_id: msg.payload.weather.snr + '_illuminance',
      unit_of_measurement: 'lx',
    }
    client.publish(hassTopicPrefix + '/sensor/' + msg.payload.weather.snr + '/illuminance/config', JSON.stringify(illuminance_payload))

    var temperature_payload = {
      ...payload,
      state_topic: 'warema/' + msg.payload.weather.snr + '/temperature/state',
      device_class: 'temperature',
      name: 'temp',
      unique_id: msg.payload.weather.snr + '_temperature',
      unit_of_measurement: '°C',
    }
    client.publish(hassTopicPrefix + '/sensor/' + msg.payload.weather.snr + '/temperature/config', JSON.stringify(temperature_payload))

    var wind_payload = {
      ...payload,
      state_topic: 'warema/' + msg.payload.weather.snr + '/wind/state',
      icon: 'mdi:weather-windy',
      name: 'wind',
      unique_id: msg.payload.weather.snr + '_wind',
      unit_of_measurement: 'km/h',
    }
    client.publish(hassTopicPrefix + '/sensor/' + msg.payload.weather.snr + '/wind/config', JSON.stringify(wind_payload))

    client.publish(availability_topic, 'online', { retain: true })
    registered_shades += msg.payload.weather.snr
  }
}

function callback(err, msg) {
  //console.log('callback err_va:', err, 'msg_val:', msg);
  if (err) {
    console.log('ERROR: ' + err);
  }
  
  if (msg) {
    console.log('Message topic: ' + msg.topic)
    switch (msg.topic) {
      case 'wms-vb-init-completion':
        console.log('Warema init completed')
        registerDevices()
        stickUsb.setPosUpdInterval(30000);
        break
      case 'wms-vb-rcv-weather-broadcast':
        handleWeatherBroadcast(msg)
        break
      case 'wms-vb-blind-position-update':
        client.publish('warema/' + msg.payload.snr + '/position', msg.payload.position.toString())
        // client.publish('warema/' + msg.payload.snr + '/tilt', msg.payload.angle.toString())
        shade_position[msg.payload.snr] = {
          position: msg.payload.position,
          angle: msg.payload.angle
        }
        break
      case 'wms-vb-scanned-devices':
        console.log('Scanned devices.')
        msg.payload.devices.forEach(element => registerDevice(element))
        console.log(stickUsb.vnBlindsList())
        break
      default:
        console.log('UNKNOWN MESSAGE: ' + JSON.stringify(msg));
    }
  }
}

var client = mqtt.connect(
  process.env.MQTT_SERVER,
  {
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
    will: {
      topic: 'warema/bridge/state',
      payload: 'online',
      retain: true
    }
  }
)

var stickUsb

client.on('connect', function (connack) {
  console.log('Connected to MQTT')
  client.subscribe('warema/#', { 'nl': true })
  client.subscribe('homeassistant/status')
  stickUsb = new warema(settingsPar.wmsSerialPort,
    settingsPar.wmsChannel,
    settingsPar.wmsPanid,
    settingsPar.wmsKey,
    {},
    callback
  );
})

client.on('error', function (error) {
  console.log('MQTT Error: ' + error.toString())
})

client.on('message', function (topic, message) {
  // console.log(topic + ':' + message.toString())
  var scope = topic.split('/')[0]
  if (scope == 'warema') {
    var device = parseInt(topic.split('/')[1])
    var command = topic.split('/')[2]
    switch (command) {
      case 'set':
        switch (message.toString()) {
          case 'CLOSE':
            stickUsb.vnBlindSetPosition(device, 100, 0)
            break;
          case 'OPEN':
            stickUsb.vnBlindSetPosition(device, 0, 0)
            break;
          case 'STOP':
            stickUsb.vnBlindStop(device)
            break;
        }
        break
      case 'set_position':
        stickUsb.vnBlindSetPosition(device, parseInt(message), parseInt(shade_position[device]['angle']))
        break
      case 'set_tilt':
        stickUsb.vnBlindSetPosition(device, parseInt(shade_position[device]['position']), parseInt(message))
        break
      default:
        console.log('Unrecognised command from HA', command, topic, message.toString())
    }
  } else if (scope == 'homeassistant') {
    if (topic.split('/')[1] == 'status' && message.toString() == 'online') {
      console.log('Homeassistant status changed to ONLINE')
      registered_shades = []
      weatherFirstPushed = false
      registerDevices();
      stickUsb.vnBlindGetPosition();
    }
  }
})
