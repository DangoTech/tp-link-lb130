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

class TPLinkLB130 {

  constructor(ip) {
    this.LB130_ADDRESS = ip;
    this.LB130_PORT = 9999;
    this.TCP_HEADER_BYTES = new Buffer('0000008c', 'hex');
  }

  sendUDPRequest(bulbCommand) {

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
          let decryptedResponseBuffer = this.decryptUDP(responseBuffer);

          console.log(`[UDP] Response from ${destination.address}:${destination.port}...`);
          console.log(decryptedResponseBuffer.toString());
          console.log('--------------');

          client.close();
          resolve(decryptedResponseBuffer);
        });
      
      // send request to bulb
      let requestDataBuffer = this.encrypt(new Buffer(JSON.stringify(bulbCommand)));
      client.send(
        requestDataBuffer, 
        0, 
        requestDataBuffer.length, 
        this.LB130_PORT, 
        this.LB130_ADDRESS,
        (err, bytes) => {
          console.log(`[UDP] ${bytes} bytes sent | error: ${err}`);
          console.log(JSON.stringify(bulbCommand));
          console.log('--------------');
        });
      });
  }

  // on/off commands can be sent over TCP as well as UDP
  // an extra 4 byte header must be prepended
  sendTCPRequest(bulbCommand) {

    return new Promise((resolve, reject) => {
      let decryptedResponseBuffer;
      let requestBuffer = 
        Buffer.concat([
          this.TCP_HEADER_BYTES,    // add TCP request header info back in
          this.encrypt(new Buffer(JSON.stringify(bulbCommand)))
        ]);

      var client = new net.Socket();

      // listener for responses
      client.on('data', 
        (responseBuffer) => {
          decryptedResponseBuffer = this.decryptTCP(responseBuffer);

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
      client.connect(this.LB130_PORT, this.LB130_ADDRESS, 
        () => {
          console.log(`[TCP] Connected to ${client.remoteAddress}:${client.remotePort}`);

          client.write(requestBuffer.toString('hex'), 'hex');

          console.log(`[TCP] Data sent`);
          console.log(JSON.stringify(bulbCommand));
          console.log('--------------');
        });
    });
    
  }

  encrypt(unencryptedBuffer) {
    return this.xor(unencryptedBuffer, false);
  }

  decryptUDP(encryptedBuffer){
    return this.xor(encryptedBuffer, true);
  }

  decryptTCP(encryptedBuffer){
    // ignore TCP header info in the first 4 bytes in encrypted data
    return this.xor(encryptedBuffer, true, 4);
  }

  xor(sourceBuffer, isSourceEncrypted, numOfBytesToSkip){
    numOfBytesToSkip = numOfBytesToSkip === undefined ? 0: numOfBytesToSkip;
    let encryptionKey = 171;
    
    let bufferSize = Buffer.byteLength(sourceBuffer);
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

exports = TPLinkLB130;

