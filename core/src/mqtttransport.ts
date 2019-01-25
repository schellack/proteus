import { MessageTransport} from "common:messagetransport";
import {connect, Client} from 'mqtt';
import { Partitions } from "common:protocol";

// MQTT topic Protocol: /partition/address/channel
export class MQTTTransport extends MessageTransport
{
    protected client:Client;
    protected message_regex:RegExp;
    constructor(server:string)
    {
        super();
        this.message_regex = new RegExp('/(.*)/(.*)/(.*)')
        this.client = connect(server);
        this.client.on('message', this.parseMessage);
        for(let channel in Partitions)
        {
            this.client.subscribe(channel);
        }
    };

    protected parseMessage(topic:string, content)
    {
        let parts = this.message_regex.exec(topic);
        super.recieveMessage(<Partitions>parts[1], parts[2], parts[3], JSON.parse(content));
    };

    public sendMessage(partition:Partitions, channel:string, address:string, content:any)
    {
        if (!this.client.connected && !this.client.reconnecting)
        {
            this.client.reconnect();
        }
        let topic = "/" + partition + "/" + channel + "/" + address;
        this.client.publish(topic, JSON.stringify(content));
    };
};
