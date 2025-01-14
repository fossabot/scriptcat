/* eslint-disable camelcase */
/* eslint-disable max-classes-per-file */
import { Channel } from "@App/app/message/channel";
import { MessageManager } from "@App/app/message/message";
import { ScriptRunResouce } from "@App/app/repo/scripts";
import { blobToBase64 } from "@App/utils/script";
import { v4 as uuidv4 } from "uuid";
import { ValueUpdateData } from "./exec_script";

interface ApiParam {
  depend?: string[];
  listener?: () => void;
}

export interface ApiValue {
  api: any;
  param: ApiParam;
}

export class GMContext {
  static apis: Map<string, ApiValue> = new Map();

  public static API(param: ApiParam = {}) {
    return (
      target: any,
      propertyName: string,
      descriptor: PropertyDescriptor
    ) => {
      const key = propertyName;
      if (param.listener) {
        param.listener();
      }
      GMContext.apis.set(key, {
        api: descriptor.value,
        param,
      });
      // 兼容GM.*
      let dot = key.replace("_", ".");
      if (dot !== key) {
        // 特殊处理GM.xmlHttpRequest
        if (dot === "GM.xmlhttpRequest") {
          dot = "GM.xmlHttpRequest";
        }
        GMContext.apis.set(dot, {
          api: descriptor.value,
          param,
        });
      }
    };
  }
}

export default class GMApi {
  scriptRes!: ScriptRunResouce;

  message!: MessageManager;

  runFlag!: string;

  valueChangeListener = new Map<
    number,
    { name: string; listener: GMTypes.ValueChangeListener }
  >();

  // 单次回调使用
  public sendMessage(api: string, params: any[]) {
    return this.message.syncSend("gmApi", {
      api,
      scriptId: this.scriptRes.id,
      params,
      runFlag: this.runFlag,
    });
  }

  // 长连接使用,connect只用于接受消息,不能发送消息
  public connect(api: string, params: any[]): Channel {
    const uuid = uuidv4();
    const channel = this.message.channel(uuid);
    channel.channel("gmApiChannel", {
      api,
      scriptId: this.scriptRes.id,
      params,
      runFlag: this.runFlag,
    });
    return channel;
  }

  public valueUpdate(data: ValueUpdateData) {
    const { storagename } = this.scriptRes.metadata;
    if (
      data.value.scriptId === this.scriptRes.id ||
      (storagename &&
        data.value.storageName &&
        storagename[0] === data.value.storageName)
    ) {
      // 触发,并更新值
      if (data.value.value === undefined) {
        delete this.scriptRes.value[data.value.key];
      } else {
        this.scriptRes.value[data.value.key] = data.value;
      }
      this.valueChangeListener.forEach((item) => {
        if (item.name === data.value.key) {
          item.listener(
            data.value.key,
            data.oldValue,
            data.value.value,
            data.sender.runFlag !== this.runFlag,
            data.sender.tabId
          );
        }
      });
    }
  }

  // 获取脚本信息和管理器信息
  @GMContext.API()
  public GM_info() {
    return {
      scriptWillUpdate: false,
      scriptHandler: "ScriptCat",
      scriptUpdateURL: this.scriptRes.checkUpdateUrl,
      scriptSource: this.scriptRes.code,
      script: {
        name: this.scriptRes.name,
        namespace: this.scriptRes.namespace,
        version:
          this.scriptRes.metadata.version && this.scriptRes.metadata.version[0],
        author: this.scriptRes.author,
      },
    };
  }

  // 获取脚本的值,可以通过@storageName让多个脚本共享一个储存空间
  @GMContext.API()
  public GM_getValue(key: string, defaultValue?: any) {
    const ret = this.scriptRes.value[key];
    if (ret) {
      return ret.value;
    }
    return defaultValue;
  }

  @GMContext.API()
  public GM_setValue(key: string, value: any) {
    // 对object的value进行一次转化
    if (typeof value === "object") {
      value = JSON.parse(JSON.stringify(value));
    }
    let ret = this.scriptRes.value[key];
    if (ret) {
      ret.value = value;
    } else {
      ret = {
        id: 0,
        scriptId: this.scriptRes.id,
        storageName:
          (this.scriptRes.metadata.storagename &&
            this.scriptRes.metadata.storagename[0]) ||
          "",
        key,
        value,
        createtime: new Date().getTime(),
      };
    }
    if (value === undefined) {
      delete this.scriptRes.value[key];
    } else {
      this.scriptRes.value[key] = ret;
    }
    return this.sendMessage("GM_setValue", [key, value]);
  }

  @GMContext.API({ depend: ["GM_setValue"] })
  public GM_deleteValue(name: string): void {
    this.GM_setValue(name, undefined);
  }

  @GMContext.API()
  public GM_listValues(): string[] {
    return Object.keys(this.scriptRes.value);
  }

  @GMContext.API()
  public GM_addValueChangeListener(
    name: string,
    listener: GMTypes.ValueChangeListener
  ): number {
    const id = Math.random() * 10000000;
    this.valueChangeListener.set(id, { name, listener });
    return id;
  }

  @GMContext.API()
  public GM_removeValueChangeListener(listenerId: number): void {
    this.valueChangeListener.delete(listenerId);
  }

  // 辅助GM_xml获取blob数据
  @GMContext.API()
  public CAT_fetchBlob(url: string): Promise<Blob> {
    return new Promise((resolve) => {
      resolve(new Blob());
    });
  }

  // 辅助GM_xml发送blob数据
  @GMContext.API()
  public CAT_createBlobUrl(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
      resolve("ok");
    });
  }

  // 用于脚本跨域请求,需要@connect domain指定允许的域名
  @GMContext.API({ depend: ["CAT_fetchBlob", "CAT_createBlobUrl"] })
  public async GM_xmlhttpRequest(details: GMTypes.XHRDetails) {
    const u = new URL(details.url, window.location.href);
    if (details.headers) {
      Object.keys(details.headers).forEach((key) => {
        if (key.toLowerCase() === "cookie") {
          details.cookie = details.headers![key];
          delete details.headers![key];
        }
      });
    }

    const param: GMSend.XHRDetails = {
      method: details.method,
      timeout: details.timeout,
      url: u.href,
      headers: details.headers,
      cookie: details.cookie,
      context: details.context,
      responseType: details.responseType,
      overrideMimeType: details.overrideMimeType,
      anonymous: details.anonymous,
      user: details.user,
      password: details.password,
      maxRedirects: details.maxRedirects,
    };
    if (!param.headers) {
      param.headers = {};
    }
    if (details.nocache) {
      param.headers["Cache-Control"] = "no-cache";
    }

    if (details.data) {
      if (details.data instanceof FormData) {
        param.dataType = "FormData";
        const data: Array<GMSend.XHRFormData> = [];
        const keys: { [key: string]: boolean } = {};
        details.data.forEach((val, key) => {
          keys[key] = true;
        });
        const asyncArr = Object.keys(keys).map((key) => {
          const values = (<FormData>details.data).getAll(key);
          const asyncArr2 = values.map((val) => {
            return new Promise<void>((resolve) => {
              if (val instanceof File) {
                blobToBase64(val).then((base64) => {
                  data.push({
                    key,
                    type: "file",
                    val: base64 || "",
                    filename: val.name,
                  });
                  resolve();
                });
              } else {
                data.push({
                  key,
                  type: "text",
                  val,
                });
                resolve();
              }
            });
          });
          return Promise.all(asyncArr2);
        });
        await Promise.all(asyncArr);
        param.data = data;
      } else if (details.data instanceof Blob) {
        param.dataType = "Blob";
        param.data = await this.CAT_createBlobUrl(details.data);
      } else {
        param.data = details.data;
      }
    }

    // 如果返回类型是arraybuffer或者blob的情况下,需要将返回的数据转化为blob
    // 在background通过URL.createObjectURL转化为url,然后在content页读取url获取blob对象
    if (
      details.onload &&
      (details.responseType === "arraybuffer" ||
        details.responseType === "blob")
    ) {
      const old = details.onload;
      details.onload = async (xhr) => {
        const resp = await this.CAT_fetchBlob(<string>xhr.response);
        if (details.responseType === "arraybuffer") {
          xhr.response = await resp.arrayBuffer();
        } else {
          xhr.response = resp;
        }
        old(xhr);
      };
    }

    const connect = this.connect("GM_xmlhttpRequest", [param]);
    connect.setHandler((resp: any) => {
      console.log(resp, "resp");
    });
    connect.setCatch((err) => {
      console.log(err, "err");
      connect.disChannel();
    });
    // connect.send("GM_xmlhttpRequest", param);

    return {
      abort: () => {
        connect.disChannel();
      },
    };
  }
}
