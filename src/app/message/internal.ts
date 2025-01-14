import { Channel } from "./channel";
import {
  ChannelManager,
  MessageHander,
  MessageManager,
  Target,
  TargetTag,
  WarpChannelManager,
} from "./message";

// 扩展内部页用连接,除background页使用,使用runtime.connect连接到background
export default class MessageInternal
  extends MessageHander
  implements MessageManager
{
  static instance: MessageInternal;

  static getInstance() {
    return MessageInternal.instance;
  }

  port: chrome.runtime.Port;

  channelManager: ChannelManager;

  constructor(tag: TargetTag) {
    super();
    this.port = chrome.runtime.connect({
      name: tag,
    });
    this.channelManager = new WarpChannelManager((data) => {
      this.nativeSend(data);
    });

    this.port.onMessage.addListener((message) => {
      this.handler(message, this.channelManager, { targetTag: "content" });
    });
    this.port.onDisconnect.addListener(() => {
      this.channelManager.free();
    });
    if (!MessageInternal.instance) {
      MessageInternal.instance = this;
    }
  }

  // 组合ChannelManager
  getChannel(flag: string): Channel | undefined {
    return this.channelManager.getChannel(flag);
  }

  channel(flag?: string): Channel {
    return this.channelManager.channel(flag);
  }

  disChannel(channel: Channel): void {
    this.channelManager.disChannel(channel);
  }

  free(): void {
    this.channelManager.free();
  }

  nativeSend(data: any): void {
    this.port.postMessage(data);
  }

  public send(action: string, data: any) {
    this.port.postMessage({
      action,
      data,
    });
  }

  // 发送有返回的消息
  public syncSend(action: string, data: any): Promise<any> {
    const channel = this.channelManager.channel();
    return channel.syncSend(action, data);
  }

  // 广播
  public broadcast(_target: Target, action: string, data: any) {
    this.nativeSend({
      action,
      data,
      broadcast: true,
    });
  }
}
