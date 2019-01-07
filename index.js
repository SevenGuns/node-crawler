const http = require('http');
const fs = require('fs');
const cheerio = require('cheerio');

class DataList { // 封装数据操作，持久化
    constructor() {
        const self = this;
        self.path = 'data.json';
        self.sourceDataList = [];
        self.promiseData = new Promise((rs) => {
            fs.readFile(self.path, (err, data) => {
                if (err) throw err;
                rs(data.length === 0 ? [] : JSON.parse(data));
            });
        })
    }
    connect() { // 读取存档，获得当前位置
        const self = this;
        return self.promiseData.then(list => {
            if (list.length === 0) {
                return [0, 0];
            }
            self.sourceDataList = list;
            const x = self.sourceDataList.length - 1;
            const children = self.sourceDataList[x] || [];
            const y = children.length;
            return [x, y];
        })
    }
    save(list) { // 保存
        const self = this;
        return new Promise((rs) => {
            fs.writeFile(self.path, JSON.stringify(list || self.sourceDataList), (err) => {
                if (err) throw err;
                rs();
            });
        })
    }
    push(pageIndex, data) { // 添加数据，自动处理翻页
        const self = this;
        const page = self.sourceDataList[pageIndex];
        if (!page) {
            self.sourceDataList[pageIndex] = [data];
            return;
        }
        page.push(data);
    }

    print() { // 打印结果
        const list = this.sourceDataList.reduce((prev, curr) => prev.concat(curr));
        return new Promise((rs) => {
            fs.writeFile('list.json', JSON.stringify(list), (err) => {
                if (err) throw err;
                rs();
            });
        })
    }
}
function curl(url) { // 封装请求函数
    return new Promise((rs) => {
        try {
            http.get(url, (res) => {
                res.setEncoding('utf8');
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => rs(data))
            }).on('error', (e) => {
                rs('超时');
                console.error(url);
            });
        } catch(e) {
            rs('超时');
            console.error(url);
        }
    })
}


async function start([startX, startY]) { // [x, y]存档位置
    console.log('开始');
    const origin = 'http://tjj.hunan.gov.cn/tjfx/tjgb/xqtjgb/';
    let loop = true;
    let page = startX;
    let y = startY;
    do {
        console.log(`第${page}页`);
        const url = `${origin}index${page ? `_${page}` : ''}.html`
        const html = await curl(url);
        const $ = cheerio.load(html);
        const list = [];
        $('.ccenter > a').each((i, element) => { // 列表数据
            if (i < y) { // 从存档位置开始
                return;
            }
            const title = element.childNodes[0].data;
            const year = (title.match(/\d+年/) || [])[0];
            if (year !== '2017年') { // 截止到2017年 跳出循环
                loop = false;
                return;
            }
            const city = (title.match(/(?<=·).*?(?=2017)/) || [])[0];
            list.push({
                title,
                url: element.attribs.href,
                year,
                city
            });
        });
        if (list.length === 0) { // 列表爬取失败 自动重试
            continue;
        }
        for (let obj of list) {
            let num;
            const emptyCity = new Set(['娄星区', '赫山区', '北塔区']); // 白名单
            if (emptyCity.has(obj.city)) {
                num = '没有记录';
            } else {
                num = await find(obj.url);
            }
            console.log(obj.city, obj.url, num);
            dataList.push(page, { // 存数据
                ...obj,
                num
            });
        }
        page++; // 翻页
        y = 0; // y清0
    } while (loop);
    console.log('结束');
}
// 记录已经成功的
async function find(url) {
    let i = 0;
    const loopFetch = () => { // 防止丢包 自动重试
        return curl(url).then(html => {
            const $ = cheerio.load(html);
            const content = $('#d_article').eq(0).text(); // 目标文档内容
            if (content) {
                return content;
            }
            return Promise.reject('content为空')
        }).catch(e => {
            console.error(`失败重试${++i}次`);
            return new Promise((rs, rj) => {
                setTimeout(() => {
                    rs(loopFetch());
                }, 500); // 500毫秒重试
            });
        });
    }
    const content = await loopFetch();
    try {
        return macth(content);
    } catch(e) {
        console.error(e.toString(), url); // 打印目标 方便校准
        throw e; // 抛出异常 停止爬虫 人工干预校准
    }
}


function macth(content = '') { // 匹配函数
    const regexs = [
        /(?<=常住人口)\d+(\.\d+)?万(?=人)/,
        /(?<=常住人口为)\d+(\.\d+)?万(?=人)/,
        /(?<=常住总人口)\d+(\.\d+)?万(?=人)/,
        /(?<=户籍人口)\d+(\.\d+)?万(?=人)/,
        /(?<=户籍人口)\d+(?=人)/,
        /(?<=总人口)\d+(\.\d+)?万(?=人)/,
        /(?<=户籍总人口)\d+(?=人)/,
        /(?<=总人口为)\d+(\.\d+)?万(?=人)/,
        /(?<=总人口为)\d+(?=人)/,
        /(?<=总人口)\d+(?=人)/,
        /(?<=全区户籍人口)\d+(?=人)/,
        /(?<=常住人口数为)\d+(\.\d+)?万/,
        /(?<=户籍人口总数)\d+(\.\d+)?万(?=人)/,
    ];
    for (let regex of regexs) {
        const str = (content.match(regex) || [])[0];
        if (str && isNumber(str)) {
            return str;
        }    
    }
    throw new Error('匹配失败'); // 匹配失败: 说明匹配函数需要校准
}


function isNumber(param) { // 校验匹配的数据
    let str = param;
    const n = str.slice(-1);
    if (n === '万') {
        str = str.substr(0, str.length - 1);
    }
    return !isNaN(str);
}

const dataList = new DataList();
dataList
    .connect() // 读取存档
    .then(start) // 开始爬虫
    .then(() => dataList.print()) // 打印输出
    .finally(() => dataList.save()); // 自动保存当前进度