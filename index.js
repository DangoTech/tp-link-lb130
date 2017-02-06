'use strict';

var net = require('net');

class BulbCommand {
  constructor() {
    this['smartlife.iot.smartbulb.lightingservice'] = {};
  }
}

class BulbGetCommand extends BulbCommand {
  constructor() {
    super();
    this['smartlife.iot.smartbulb.lightingservice'].get_light_state = {};
  }
}

class BulbTransitionCommand extends BulbCommand {
  constructor() {
    super();
    this['smartlife.iot.smartbulb.lightingservice'].transition_light_state = {
      ignore_default: 0,
      mode: "normal",
      transition_period: 0
    };
  }
}

class BulbCommandOnOff extends BulbTransitionCommand {
  constructor(isOn, transitionPeriod) {
    super();
    let transition = this['smartlife.iot.smartbulb.lightingservice'].transition_light_state;
    transition.on_off = isOn;
    if (transitionPeriod !== undefined) {
      transition.transition_period = transitionPeriod;
    }
  }
}

class BulbCommandBrightness extends BulbTransitionCommand {

  // brightness: 0-100
  constructor(brightness, transitionPeriod) {
    super();
    let transition = this['smartlife.iot.smartbulb.lightingservice'].transition_light_state;
    transition.on_off = 1;
    transition.brightness = brightness;
    transition.transition_period = transitionPeriod;
  }
}

class BulbCommandColor extends BulbTransitionCommand {

  // brightness: 0-100
  // hue: 0-360
  // saturation: 0-100
  constructor(brightness, hue, saturation, transitionPeriod) {
    super();
    let transition = this['smartlife.iot.smartbulb.lightingservice'].transition_light_state;
    transition.ignore_default = 1;
    transition.on_off = 1;
    transition.color_temp = 0;

    transition.brightness = brightness;
    transition.hue = hue;
    transition.saturation = saturation;
    transition.transition_period = transitionPeriod;
  }
}

class TPLinkLB130Helper {

  static get LB130_PORT() {
    return 9999;
  }
  static get TCP_HEADER_BYTES() {
    return new Buffer('0000008c', 'hex');
  }

  static sendUDPRequest(bulbCommand, address) {

    return new Promise((resolve, reject) => {
      const dgram = require('dgram');
      const client = dgram.createSocket('udp4');

      // listener for connection
      client.on('listening', 
        () => {
          console.log(`[UDP] Listening on local ${client.address().address}:${client.address().port}`);
        });

      // listener for responses
      client.on('message',
        (responseBuffer, destination) => {
          let decryptedResponseBuffer = TPLinkLB130Helper.decryptUDP(responseBuffer);

          console.log(`[UDP] Response from ${destination.address}:${destination.port}...`);
          console.log(decryptedResponseBuffer.toString());
          console.log('--------------');

          client.close();
          resolve(decryptedResponseBuffer);
        });
      
      // send request to bulb
      let requestDataBuffer = TPLinkLB130Helper.encrypt(new Buffer(JSON.stringify(bulbCommand)));
      client.send(
        requestDataBuffer, 
        0, 
        requestDataBuffer.length, 
        TPLinkLB130Helper.LB130_PORT, 
        address,
        (err, bytes) => {
          console.log(`[UDP] ${bytes} bytes sent | error: ${err}`);
          console.log(JSON.stringify(bulbCommand));
          console.log('--------------');
        });
      });
  }

  // on/off commands can be sent over TCP as well as UDP
  // an extra 4 byte header must be prepended
  static sendTCPRequest(bulbCommand, address) {

    return new Promise((resolve, reject) => {
      let decryptedResponseBuffer;
      let requestBuffer = 
        Buffer.concat([
          TPLinkLB130Helper.TCP_HEADER_BYTES,    // add TCP request header info back in
          TPLinkLB130Helper.encrypt(new Buffer(JSON.stringify(bulbCommand)))
        ]);

      var client = new net.Socket();

      // listener for responses
      client.on('data', 
        (responseBuffer) => {
          decryptedResponseBuffer = TPLinkLB130Helper.decryptTCP(responseBuffer);

          console.log(`[TCP] Response from ${client.remoteAddress}:${client.remotePort}...`);
          console.log(decryptedResponseBuffer.toString());
          console.log('--------------');
          
          client.destroy();
        });

      // listener for connection close
      client.on('close', 
        () => {
          console.log(`[TCP] Connection to ${client.remoteAddress}:${client.remotePort} closed`);
          resolve(decryptedResponseBuffer);
        });

      // connect to bulb and send request
      client.connect(TPLinkLB130Helper.LB130_PORT, address, 
        () => {
          console.log(`[TCP] Connected to ${client.remoteAddress}:${client.remotePort}`);

          client.write(requestBuffer.toString('hex'), 'hex');

          console.log(`[TCP] Data sent`);
          console.log(JSON.stringify(bulbCommand));
          console.log('--------------');
        });
    });
    
  }

  static encrypt(unencryptedBuffer) {
    return TPLinkLB130Helper.xor(unencryptedBuffer, false);
  }

  static decryptUDP(encryptedBuffer){
    return TPLinkLB130Helper.xor(encryptedBuffer, true);
  }

  static decryptTCP(encryptedBuffer){
    // ignore TCP header info in the first 4 bytes in encrypted data
    return TPLinkLB130Helper.xor(encryptedBuffer, true, 4);
  }

  static xor(sourceBuffer, isSourceEncrypted, numOfBytesToSkip){
    numOfBytesToSkip = numOfBytesToSkip === undefined ? 0: numOfBytesToSkip;
    let encryptionKey = 171;
    
    let bufferSize = sourceBuffer.length;
    let destBuffer = new Buffer(bufferSize - numOfBytesToSkip);
    let bytesRead = numOfBytesToSkip;
    let key = encryptionKey;

    while (bytesRead < bufferSize) {
      let nextByteInt = sourceBuffer.readUInt8(bytesRead);

      destBuffer.writeUInt8((nextByteInt^key), (bytesRead - numOfBytesToSkip));

      // xor must be always done with the previous _encrypted_ byte,
      // so if the input is encrypted, we just use the byte as is,
      // if the input is unencrypted, we just the xor'ed byte as the next key
      key = isSourceEncrypted ? nextByteInt : nextByteInt^key;

      bytesRead++;
    }

    return destBuffer;
  }

}

class TPLinkLB130 {

  constructor(ip) {
    this.LB130_ADDRESS = ip;
  }

  getStatus() {
    return TPLinkLB130Helper.sendUDPRequest(new BulbGetCommand(), this.LB130_ADDRESS)
      .then((responseBuffer) => {
        let lightState = JSON.parse(responseBuffer.toString())['smartlife.iot.smartbulb.lightingservice'].get_light_state;
        let onState;
        if (lightState.on_off === 0) {
          onState = lightState.dft_on_state;
          onState.on_off = 0;
        }
        else {
          onState = lightState;
        }
        return onState;
      });
  }

  turnOn(transitionPeriod) {
    return TPLinkLB130Helper.sendUDPRequest(new BulbCommandOnOff(1, transitionPeriod), this.LB130_ADDRESS);
  }

  turnOff(transitionPeriod) {
    return TPLinkLB130Helper.sendUDPRequest(new BulbCommandOnOff(0, transitionPeriod), this.LB130_ADDRESS);
  }

  changeBrightness(brightness, transitionPeriod) {
    return TPLinkLB130Helper.sendUDPRequest(new BulbCommandBrightness(brightness, transitionPeriod), this.LB130_ADDRESS);
  }

  changeColor(brightness, hue, saturation, transitionPeriod) {
    return TPLinkLB130Helper.sendUDPRequest(new BulbCommandColor(brightness, hue, saturation, transitionPeriod), this.LB130_ADDRESS);
  }
}

modules.exports = TPLinkLB130;