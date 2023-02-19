var audio = new Audio('lofi.mp3');
function parse_cookies(cookies) {
    const result = {};
    cookies.split(/\s*;\s*/).forEach(function(pair) {
        pair = pair.split(/\s*=\s*/);
        var name = decodeURIComponent(pair[0]);
        var value = decodeURIComponent(pair.splice(1).join('='));
        result[name] = value;
    });
    return result;
}

function is_function(obj) {
    return typeof obj === 'function';
}

function is_promise(obj) {
    return obj && is_function(obj.then);
}

function is_node() {
    return typeof process !== 'undefined' &&
        process.release.name === 'node';
}

// based on https://stackoverflow.com/a/46282334/387194
function extend(object, prototype) {
    const descriptors = Object.getOwnPropertyDescriptors(object);
    for (const prop in descriptors) {
        Object.defineProperty(prototype, prop, descriptors[prop]);
    }
}

const loops = {};

const Gaiman = {
    _get_time() {
        return +new Date;
    },
    should_break_loop(id) {
        if (!loops[id]) {
            loops[id] = {
                start: this._get_time(),
                count: 1
            };
            return false;
        } else {
            var now = this._get_time();
            const { start } = loops[id];
            const count = ++loops[id].count;
            if (count > this._config.loop_threshold) {
                const stop = now - start > this._config.loop_timeout;
                if (stop) {
                    window.parent.postMessage({
                        message: 'Infinite Loop detected!',
                        colno: null,
                        lineno: null
                    });
                }
                return stop;
            }
            return false;
        }
    },
    exit_loop(id) {
        delete loops[id];
    },
    type(obj) {
        if (obj === 'null') {
            return 'null';
        } else if (Number.isNaN(obj)) {
            return 'nan';
        } else if (obj instanceof Array) {
            return 'array';
        } else {
            var type = typeof obj;
            if (type === 'object') {
                // https://tinyurl.com/fixing-typeof
                return ({}).toString.call(obj).match(/\s([a-zA-Z]+)/)[1].toLowerCase();
            }
            return type;
        }
    },
    parse(input) {
        return $.terminal.parse_arguments(input);
    },
    parse_extra(input) {
        return $.terminal.split_arguments(input);
    },
    post(url, data = {}) {
        return $.post(url, data);
    },
    post_extra(url, data = {}) {
        return $.post(url, data, $.noop, "text");
    },
    get(url) {
        return $.get(url);
    },
    get_extra(url) {
        return $.get(url, $.noop, "text");
    },
    set_cookie(name, value) {
        document.cookie = `${name}=${value}`;
        cookie[name] = value;
    }
};

if (!('Map' in this)) {
    $.getScript('https://cdn.jsdelivr.net/gh/jcubic/static/js/map.min.js').then(() => {
        window.Map = ES6_Map;
    });
}

function to_string(object) {
    if (object instanceof Array) {
        object = object.map(to_string);
    } else {
        var type = typeof object;
        if (type === 'number') {
            object = String(object);
        } else if (type !== 'string') {
            if (object) {
                object = JSON.stringify(object, null, 2);
            } else {
                object = String(object);
            }
        }
    }
    return object;
}

class WebAdapter {
    constructor(config = {}) {
        this._config = $.extend({
            newline: true,
            loop_threshold: 500,
            loop_timeout: 200
        }, config);
        var root = $('#term');
        var options = root.css('--options');
        if (typeof options === 'undefined') {
            options = {};
        } else {
            try {
                options = JSON.parse(options);
            } catch(e) {
                console.warn('Gaiman: Invalid --option CSS variable');
                options = {};
            }
        }
        this._term = root.terminal($.noop, $.extend({
            greetings: false,
            exit: false,
            exceptionHandler(e) {
                if (is_iframe) {
                    window.parent.postMessage({
                        message: 'Internal: ' + e.message,
                        colno: null,
                        lineno: null
                    });
                } else {
                    throw e;
                }
            }
        }, options));
    }
    config(name, value) {
        if (typeof name === 'string') {
            this._config[name] = value;
        } else {
            const { completion, ...rest } = name;
            this._term.settings().completion = completion;
            $.extend(rest, name);
        }
    }
    store(name, ...args) {
        try {
            if (args.length === 0) {
                return JSON.parse(localStorage.getItem(name));
            } else {
                const [ value ] = args;
                localStorage.setItem(name, JSON.stringify(value));
            }
        } catch(e) {
            // ignore errors that may happen in Incognito mode
        }
    }
    sleep(timeout, visible = false) {
        this._term.pause(visible);
        return new Promise(resolve => {
            setTimeout(() => {
                this._term.resume();
                resolve();
            }, Number(timeout));
        });
    }
    sleep_extra(timeout) {
        return this.sleep(timeout, true);
    }
    mask(char) {
        if (arguments.length === 0) {
            return this._term.cmd().mask();
        }
        this._term.set_mask(char);
    }
    error(e) {
        var message;
        if (e.statusText) {
            message = `Failed to fetch: ${e.url}\n${e.statusText}`;
        } else {
            message = e.message || e;
        }
        this._term.error(message);
    }
    echo(arg) {
        this._term.echo(to_string(arg), { newline: this._config.newline });
    }
    echo_extra(string, delay) {
        return this._term.echo(string, { typing: true, delay });
    }
    ask(message, validator = () => true) {
        return new Promise(resolve => {
            this._term.push(result => {
                return Promise.resolve().then(async () => {
                    if (typeof validator !== 'function') {
                        throw new Error('ask validator needs to be a function');
                    }
                    if (await validator(result)) {
                        this._term.pop();
                        resolve(result);
                    }
                });
            }, {
                prompt: message
            });
        });
    }
    ask_extra(message, delay, validator = () => true) {
        return new Promise(resolve => {
            const prompt = this._term.get_prompt();
            this._term.push(result => {
                return Promise.resolve().then(async () => {
                    if (typeof validator !== 'function') {
                        throw new Error('ask* validator needs to be a function');
                    }
                    if (await validator(result)) {
                        this._term.pop().set_prompt(prompt);
                        resolve(result);
                    } else {
                        this._term.set_prompt(message, {
                            typing: true,
                            delay
                        });
                    }
                })
            }).set_prompt(message, {
                typing: true,
                delay
            });
        });
    }
    update(index, string) {
        this._term.update(index, string);
    }
    prompt(string) {
        this._term.set_prompt(string);
    }
    prompt_extra(string, delay) {
        return this._term.set_prompt(string, { typing: true, delay });
    }
    input(string) {
        return this._term.exec(string);
    }
    input_extra(string, delay) {
        return this._term.exec(string, { typing: true, delay });
    }
    clear() {
        this._term.clear();
    }
}

$.ajaxSetup({
    beforeSend: function(jqXHR, settings) {
        jqXHR.url = settings.url;
    }
});

extend(Gaiman, WebAdapter.prototype);

class GaimanArray extends Array {
    map(...args) {
        function call(arr) {
            return new GaimanArray(...arr);
        }
        const arr = super.map.apply(this, args);
        const some = super.some;
        const has_promise = some.call(arr, is_promise);
        if (has_promise) {
            return Promise.all(arr).then(call);
        } else {
            return call(arr);
        }
    }
    forEach(...args) {
        return this.map(...args);
    }
    filter(fn, ctx) {
        const filter = super.filter;
        function call(arr) {
            return new GaimanArray(...filter.call(arr, x => x));
        }
        const items = this.map(fn, ctx);
        if (is_promise(items)) {
            return items.then(arr => {
                return call(arr);
            });
        } else {
            return call(items);
        }
    }
    reduce(fn, init) {
        return new GaimanArray(...super.reduce.call(this, function(acc, ...args) {
            if (is_promise(acc)) {
                return acc.then(acc => {
                    return fn(acc, ...args);
                });
            } else {
                return fn(acc, ...args);
            }
        }, init));
    }
    sort(fn = defaultSortFn) {
        return mergeSort(this, fn);
    }
    some(fn, ctx) {
        const some = super.some;
        return this.mapWithCallback(fn, (arr) => {
            return some.call(arr, x => x);
        }, ctx);
    }
    every(fn, ctx) {
        const every = super.every;
        return this.mapWithCallback(fn, (arr) => {
            return every.call(arr, x => x);
        }, ctx);
    }
    find(fn, ctx) {
        return this.mapWithCallback(fn, (arr) => {
            const index = arr.findIndex(x => x);
            return this[index];
        }, ctx);
    }
    flatMap(fn, ...args) {
        return this.map(...args).flat();
    }
    mapWithCallback(fn, callback, ctx) {
        const items = this.map(fn, ctx);
        if (is_promise(items)) {
            return items.then(arr => {
                return callback(arr);
            });
        } else {
            return callback(items);
        }
    }
}

function defaultSortFn(a, b) {
    if (typeof a !== 'string') {
        a = String(a);
    }
    if (typeof b !== 'string') {
        b = String(b);
    }
    if (a < b) {
        return -1;
    }
    if (a > b) {
        return 1;
    }
    return 0;
}

// based on: https://rosettacode.org/wiki/Sorting_algorithms/Merge_sort#JavaScript
async function mergeSort(array, fn = defaultSortFn) {
    if (array.length <= 1) {
        return array;
    }
    const mid = Math.floor(array.length / 2),
          left = array.slice(0, mid), right = array.slice(mid);
    await mergeSort(left, fn);
    await mergeSort(right, fn);
    let ia = 0, il = 0, ir = 0;
    while (il < left.length && ir < right.length) {
        array[ia++] = (await fn(left[il], right[ir]) <= 0) ? left[il++] : right[ir++];
    }
    while (il < left.length) {
        array[ia++] = left[il++];
    }
    while (ir < right.length) {
        array[ia++] = right[ir++];
    }
    return array;
}

// STD library
function $_ord(x) {
    const type = typeof x;
    if (type !== 'string') {
        throw new Error(`ord: Invalid argument, expected string got ${type}`);
    }
    const len = [...x].length;
    if (len > 1) {
        throw new Error('ord: argument need to be string of length 1');
    }
    return x.codePointAt(0);
}

function $_chr(x) {
    const type = typeof x;
    if (type !== 'number') {
        throw new Error(`chr: Invalid argument, expected number got ${type}`);
    }
    return String.fromCodePoint(x);
}

function $_range(start, stop, step) {
    if (!stop) {
        stop = start;
        start = 0;
    }
    if (!step) {
        if (start > stop) {
            step = -1;
        } else {
            step = 1;
        }
    }
    if (start > stop && step > 0) {
        return new GaimanArray();
    }
    let result = new GaimanArray();
    function run() {
        result.push(start);
        start += step;
    }
    if (start > stop) {
        while (start > stop) {
            run();
        }
    } else {
        while (start < stop) {
            run();
        }
    }
    return result;
}
let $_abs = Math.abs;
let $_acos = Math.acos;
let $_acosh = Math.acosh;
let $_asin = Math.asin;
let $_asinh = Math.asinh;
let $_atan = Math.atan;
let $_atanh = Math.atanh;
let $_atan2 = Math.atan2;
let $_ceil = Math.ceil;
let $_cbrt = Math.cbrt;
let $_expm1 = Math.expm1;
let $_clz32 = Math.clz32;
let $_cos = Math.cos;
let $_cosh = Math.cosh;
let $_exp = Math.exp;
let $_floor = Math.floor;
let $_fround = Math.fround;
let $_hypot = Math.hypot;
let $_imul = Math.imul;
let $_log = Math.log;
let $_log1p = Math.log1p;
let $_log2 = Math.log2;
let $_log10 = Math.log10;
let $_max = Math.max;
let $_min = Math.min;
let $_pow = Math.pow;
let $_random = Math.random;
let $_round = Math.round;
let $_sign = Math.sign;
let $_sin = Math.sin;
let $_sinh = Math.sinh;
let $_sqrt = Math.sqrt;
let $_tan = Math.tan;
let $_tanh = Math.tanh;
let $_trunc = Math.trunc;
let $_E = Math.E;
let $_LN10 = Math.LN10;
let $_LN2 = Math.LN2;
let $_LOG10E = Math.LOG10E;
let $_LOG2E = Math.LOG2E;
let $_PI = Math.PI;
let $_SQRT1_2 = Math.SQRT1_2;
let $_SQRT2 = Math.SQRT2;

// Fisher-Yates (aka Knuth) Shuffle
// ref: https://stackoverflow.com/a/2450976/387194
function $_shuffle(array) {
  let currentIndex = array.length,  randomIndex;

  // While there remain elements to shuffle.
  while (currentIndex != 0) {

    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]];
  }

  return array;
}

var cookie, argv, gaiman, $$__m;
try {
    if (is_node()) {
        argv = process.argv;
    } else {
        cookie = parse_cookies(document.cookie);
        gaiman = new WebAdapter();
    }
    main();
} catch (e) {
    window.parent.postMessage({
        message: e.message,
        colno: null,
        lineno: null
    });
}

async function main() {
    try {
        let $_istqbuster_a_score = 0;
        async function $_istqbuster_a_1() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #1]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which one of the following answers describes a test condition?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) A distinguishing characteristic of a component or system`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) A testable aspect of a component or system identified as a basis for testing`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The degree to which a software product provides functions which meet stated and implied needs when the software is used under specified conditions`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Test cases designed to execute combinations of conditions and actions resulting from them`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_2();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_2();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_2();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_2();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_1();
            }
        }
        async function $_istqbuster_a_2() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #2]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements is a valid objective for testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The test should start as late as possible so that development had enough time to create a good product`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) To validate whether the test object works as expected by the users and other stakeholders`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) To prove that all possible defects are identified`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) To prove that any remaining defects will not cause any failures`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_3();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_3();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_3();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_3();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_2();
            }
        }
        async function $_istqbuster_a_3() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #3]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements correctly describes the difference between testing and debugging?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Testing identifies the source of defects; debugging analyzes the defects and proposes prevention activities`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Dynamic testing shows failures caused by defects; debugging eliminates the defects, which are the source of failures`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Testing removes faults; but debugging removes defects that cause the faults`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Dynamic testing prevents the causes of failures; debugging removes the failures`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_4();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_4();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_4();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_4();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_3();
            }
        }
        async function $_istqbuster_a_4() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #4]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which one of the statements below describes the most common situation for a failure discovered during testing or in production?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The product crashed when the user selected an option in a dialog box`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The wrong version of a compiled source code file was included in the build`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The computation algorithm used the wrong input variables`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The developer misinterpreted the requirement for the algorithm`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_5();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_5();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_5();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_5();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_4();
            }
        }
        async function $_istqbuster_a_5() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #5]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Mr. Test has been testing software applications on mobile devices for a period of 5 years. He has a wealth of experience in testing mobile applications and achieves better results in a shorter time than others. Over several months, Mr. Test did not modify the existing automated test cases and did not create any new test cases. This leads to fewer and fewer defects being found by executing the tests. What principle of testing did Mr. Test not observe?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Testing depends on the environment`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Exhaustive testing is not possible`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Repeating of same tests will not find new defects`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Defects cluster together`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_6();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_6();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_6();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_6();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_5();
            }
        }
        async function $_istqbuster_a_6() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #6]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]In what way can testing be part of Quality Assurance?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) It ensures that requirements are detailed enough`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Testing reduces the risk of poor software quality`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) It ensures that standards in the organization are followed`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) It measures the quality of software in terms of number of executed test cases`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_7();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_7();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_7();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_7();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_6();
            }
        }
        async function $_istqbuster_a_7() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #7]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following activities is part of the main activity (test analysis) in the test process?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Identifying any required infrastructure and tools`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Creating test suites from test scripts`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Analyzing lessons learned for process improvement`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Evaluating the test basis for testability`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_8();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_8();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_8();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_8();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_7();
            }
        }
        async function $_istqbuster_a_8() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #8]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Match the following test work products (1-4) with the right description (A-D):]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) Test suite`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) Test case`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) Test script`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) Test charter`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#A6E3A1;]A]) A set of test scripts to be executed in a specific test run`, 2);
            await gaiman.echo_extra(`[[;#A6E3A1;]B]) A set of instructions for the execution of a test`, 2);
            await gaiman.echo_extra(`[[;#A6E3A1;]C]) Contains expected results`, 2);
            await gaiman.echo_extra(`[[;#A6E3A1;]D]) Documentation of test activities in session-based exploratory testing`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 1A, 2C, 3B, 4D`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 1D, 2B, 3A, 4C`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 1A, 2C, 3D, 4B`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 1D, 2C, 3B, 4A`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_9();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_9();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_9();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_9();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_8();
            }
        }
        async function $_istqbuster_a_9() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #9]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]How can white-box testing be applied during user acceptance testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) To check if large volumes of data can be transferred between integrated systems`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) To check if all code statements and code decision paths have been executed`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) To check if all work process flows have been covered`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) To cover all web page navigations`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_10();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_10();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_10();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_10();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_9();
            }
        }
        async function $_istqbuster_a_10() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #10]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements comparing component testing and system testing is TRUE?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Component testing verifies the functionality of software modules, program objects, and classes that are separately testable, whereas system testing verifies interfaces between components and interactions between different parts of the system`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) To check if all code statements and code decision paths have been executed`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) To check if all work process flows have been covered`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) To cover all web page navigations`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_11();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_11();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_11();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_11();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_10();
            }
        }
        async function $_istqbuster_a_11() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #11]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which one of the following is TRUE?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Component testing verifies the functionality of software modules, program objects, and classes that are separately testable, whereas system testing verifies interfaces between components and interactions between different parts of the system`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) To check if all code statements and code decision paths have been executed`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) To check if all work process flows have been covered`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) To cover all web page navigations`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_12();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_12();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_12();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_12();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_11();
            }
        }
        async function $_istqbuster_a_12() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #12]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which one of the following is the BEST definition of an incremental development model?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Defining requirements, designing software and testing are done in phases where in each phase a piece of the system is added`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) A phase in the development process should begin when the previous phase is complete`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Testing is viewed as a separate phase which takes place after development has been completed`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Testing is added to development as an increment`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_13();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_13();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_13();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_13();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_12();
            }
        }
        async function $_istqbuster_a_13() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #13]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following should NOT be a trigger for maintenance testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Decision to test the maintainability of the software`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Decision to test the system after migration to a new operating platform`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Decision to test if archived data is possible to be retrieved`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Decision to test after hot fixes`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_14();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_14();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_14();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_14();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_13();
            }
        }
        async function $_istqbuster_a_14() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #14]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following options are roles in a formal review?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Developer, Moderator, Review leader, Reviewer, Tester`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Author, Moderator, Manager, Reviewer, Developer`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Author, Manager, Review leader, Reviewer, Designer`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Author, Moderator, Review leader, Reviewer, Scribe`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_15();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_15();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_15();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_15();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_14();
            }
        }
        async function $_istqbuster_a_15() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #15]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which activities are carried out within the planning of a formal review?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Collection of metrics for the evaluation of the effectiveness of the review`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Answer any questions the participants may have`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Definition and Verification of fulfillment of entry criteria for the review`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Evaluation of the review findings against the exit criteria`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_16();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_16();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_16();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_16();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_15();
            }
        }
        async function $_istqbuster_a_16() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #16]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the review types below is the BEST option to choose when the review must follow a formal process based on rules and checklists?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Informal Review`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Technical Review`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Inspection`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Walkthrough`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_17();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_17();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_17();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_17();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_16();
            }
        }
        async function $_istqbuster_a_17() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #17]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements about static testing are MOST true?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Static testing is a cheap way to detect and remove defects`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Static testing makes dynamic testing less challenging`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Static testing makes it possible to find run-time problems early in the lifecycle`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) When testing safety-critical system, static testing has less value because dynamic testing finds the defects better`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_18();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_18();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_18();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_18();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_17();
            }
        }
        async function $_istqbuster_a_18() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #18]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You will be invited to a review. The work product to be reviewed is a description of the in-house document creation process.]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]The aim of the description is to present the work distribution between the different roles involved in the process in a way that can be clearly understood by]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]everyone.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]You will be invited to a checklist-based review. The checklist will also be sent to you. It includes the following points:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) A set of test scripts to be executed in a specific test run`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) A set of instructions for the execution of a test`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) Contains expected results`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) Documentation of test activities in session-based exploratory testing`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]In the following we show an excerpt of the work result to be reviewed, for which you should use the checklist above:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]After checking the customer documentation for completeness and correctness, the software architect creates the system specification. Once the software architect has completed the system specification, he invites testers and verifiers to the review. A checklist describes the scope of the review. Each invited reviewer creates review comments - if necessary - and concludes the review with an official review done-comment.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements about your review is correct?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Point 2) of the checklist has been violated because it is not clear which condition must be fulfilled to invite to the review`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) You notice that in addition to the tester and the verifier, the validator must also be invited. Since this item is not part of your checklist, you do not create a corresponding comment`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Point 3) of the checklist has been violated as it is not clear what marks the review as completed`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Point 1) of the checklist has been violated because it is not clear who is providing the checklist for the invitation to the review`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_19();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_19();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_19();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_19();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_18();
            }
        }
        async function $_istqbuster_a_19() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #19]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]What is checklist-based testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) A test technique in which tests are derived based on the tester's knowledge of past faults, or general knowledge of failures`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) A test technique based on an analysis of the specification of a component or system`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) An experience-based test technique whereby the experienced tester uses a list of items to be noted, checked, or remembered, or a set of rules or criteria against which a product must be verified`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) An approach to testing where the testers dynamically design and execute tests based on their knowledge, exploration of the test item and the results of previous tests`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_20();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_20();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_20();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_20();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_19();
            }
        }
        async function $_istqbuster_a_20() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #20]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which one of the following options is categorized as a black-box test technique?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) A technique based on analysis of the architecture`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) A technique checking that the test object is working according to the detailed design`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) A technique based on the knowledge of past faults, or general knowledge of failures`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) A technique based on formal requirements`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_21();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_21();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_21();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_21();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_20();
            }
        }
        async function $_istqbuster_a_21() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #21]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]The following statement refers to decision coverage:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]When the code contains only a single ‘if’ statement and no loops or CASE statements, and its execution is not nested within the test,]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]any single test case we run will result in 50% decision coverage.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statement is correct?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The statement is true. Any single test case provides 100% statement coverage and therefore 50% decision coverage`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The statement is true. Any single test case would cause the outcome of the “if” statement to be either true or false`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The statement is false. A single test case can only guarantee 25% decision coverage in this case`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The statement is false. The statement is too broad. It may be correct or not, depending on the tested software`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_22();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_22();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_22();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_22();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_21();
            }
        }
        async function $_istqbuster_a_22() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #22]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which one of the following is the description of statement coverage?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) It is a metric, which is the percentage of test cases that have been executed`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) It is a metric, which is the percentage of statements in the source code that have been executed`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) It is a metric, which is the number of statements in the source code that have been executed by test cases that are passed`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) It is a metric, that gives a true/false confirmation if all statements are covered or not`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_23();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_23();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_23();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_23();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_22();
            }
        }
        async function $_istqbuster_a_23() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #23]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which statement about the relationship between statement coverage and decision coverage is true?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 100% decision coverage also guarantees 100% statement coverage`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 100% statement coverage also guarantees 100% decision coverage`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 50% decision coverage also guarantees 50% statement coverage`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Decision coverage can never reach 100%`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_24();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_24();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_24();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_24();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_23();
            }
        }
        async function $_istqbuster_a_24() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #24]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]For which of the following situations is exploratory testing suitable?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) When time pressure requires speeding up the execution of tests already specified`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) When the system is developed incrementally, and no test charter is available`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) When testers are available who have enough knowledge of similar applications and technologies`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) When an advanced knowledge of the system already exists, and evidence is to be if it should be tested intensively`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_25();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_25();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_25();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_25();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_24();
            }
        }
        async function $_istqbuster_a_25() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #25]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]An employee’s bonus is to be calculated. It cannot be negative, but it can be calculated down to zero. The bonus is based on the length of employment:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) Less than or equal to 2 years]`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) More than 2 years but less than 5 years]`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) 5 to 10 years inclusively]`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) Longer than 10 years]`, 2);
            gaiman.echo(``);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]What is the minimum number of test cases required to cover all valid equivalence partitions for calculating the bonus?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 3`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 5`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 2`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 4`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_26();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_26();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_26();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_26();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_25();
            }
        }
        async function $_istqbuster_a_26() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #26]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]A speed control and reporting system has the following characteristics:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) A set of test scripts to be executed in a specific test run.`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) you drive faster than 50 km/h, but no more than 55 km/h, you will be warned.`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) If you drive faster than 55 km/h but not more than 60 km/h, you will be fined.`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) If you drive faster than 60 km/h, your driving license will be suspended.]`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]5]) The speed in km/h is available to the system as an integer value.`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which would be the most likely set of values (km/h) identified by applying the boundary value analysis, where only the values on the boundaries of the equivalence classes are selected?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 0, 49, 20, 24, 29, 60`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 50, 2, 60`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 49, 20, 24, 2, 60, 62`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 50, 21, 2, 26, 60, 61`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_27();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_27();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_27();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_27();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_26();
            }
        }
        async function $_istqbuster_a_27() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #27]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]A company's employees are paid bonuses if they work more than a year in the company and achieve a target which is individually agreed before.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]These facts can be shown in a decision table:]`, 2);
            gaiman.echo(``);
            gaiman.echo(`+------------+-------------------+-----+----+-----+-----+`);
            gaiman.echo(`|  Test-ID   |                   | T1  | T2 | T3  | T4  |`);
            gaiman.echo(`+------------+-------------------+-----+----+-----+-----+`);
            gaiman.echo(`| Condition1 | More than 1 year? | YES | NO | NO  | YES |`);
            gaiman.echo(`| Condition2 | Agreed target?    | NO  | NO | YES | YES |`);
            gaiman.echo(`| Condition3 | Achieved target?  | NO  | NO | YES | YES |`);
            gaiman.echo(`| Action     | Bonus payment     | NO  | NO | NO  | YES |`);
            gaiman.echo(`+------------+-------------------+-----+----+-----+-----+`);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following test cases represents a situation that can happen in real life, and is missing in the above decision table?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Condition1 = YES, Condition2 = NO, Condition3 = YES, Action= NO`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Condition1 = YES, Condition2 = YES, Condition3 = NO, Action= YES`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Condition1 = NO, Condition2 = NO, Condition3 = YES, Action= NO`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Condition1 = NO, Condition2 = YES, Condition3 = NO, Action= NO`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_28();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_28();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_28();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_28();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_27();
            }
        }
        async function $_istqbuster_a_28() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #28]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements about the given state transition diagram and table of test cases is TRUE?]`, 2);
            gaiman.echo(``);
            gaiman.echo(`+---------------+   PowerOff   +--------------+`);
            gaiman.echo(`|  TV Off (S1)  |<-------------| TV Play (S3) |`);
            gaiman.echo(`+---------------+              |              |`);
            gaiman.echo(`         |  ^                  |              |`);
            gaiman.echo(` PowerOn |  | PowerOff         |              |`);
            gaiman.echo(`         v  |                  |              |`);
            gaiman.echo(`+---------------+     RCOn     |              |`);
            gaiman.echo(`|  TV Off (S1)  |------------->|              |`);
            gaiman.echo(`|               |              |              |`);
            gaiman.echo(`|               |<-------------|              |`);
            gaiman.echo(`+---------------+     RCOff    +--------------+`);
            gaiman.echo(``);
            gaiman.echo(`+-------------+-------+-------+----+-----+-------+`);
            gaiman.echo(`| Test Case   |   1   |   2   | 3  |  4  |   5   |`);
            gaiman.echo(`+-------------+-------+-------+----+-----+-------+`);
            gaiman.echo(`| Start State | S1    | S2    | S2 | S3  | S3    |`);
            gaiman.echo(`+-------------+-------+-------+----+-----+-------+`);
            gaiman.echo(`| Input       | Power | Power | RC | RC  | Power |`);
            gaiman.echo(`|             | On    | Off   | On | Off | Off   |`);
            gaiman.echo(`+-------------+-------+-------+----+-----+-------+`);
            gaiman.echo(`| Expected    | S2    | S1    | S3 | S2  | S1    |`);
            gaiman.echo(`| Final State |       |       |    |     |       |`);
            gaiman.echo(`+-------------+-------+-------+----+-----+-------+`);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The given test cases cover both valid and invalid transitions in the state transition diagram`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The given test cases represent all possible valid transitions in the state transition diagram`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The given test cases represent some of the valid transitions in the state transition diagram`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The given test cases represent pairs of transitions in the state transition diagram`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_29();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_29();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_29();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_29();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_28();
            }
        }
        async function $_istqbuster_a_29() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #29]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]A video application has the following requirement: The application shall allow playing a video on the following display resolution:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) 640x480`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) 1280x720`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) 1600x1200`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) 1920x1080`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following list of test cases is a result of applying the equivalence partitioning test technique to test this requirement?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Verify that the application can play a video on a display of size 1920x1080 (1 test case)`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Verify that the application can play a video on a display of size 640x480 and 1920x1080 (2 test cases)`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Verify that the application can play a video on each of the display sizes in the requirement (4 test cases)`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Verify that the application can play a video on any one of the display sizes in the requirement (1 test case)`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_30();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_30();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_30();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_30();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_29();
            }
        }
        async function $_istqbuster_a_30() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #30]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements BEST describes how tasks are divided between the test manager and the tester?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The test manager plans testing activities and chooses the standards to be followed, while the tester chooses the tools and set the tools usage guidelines`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The test manager plans, coordinates, and controls the testing activities, while the tester automates the tests`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The test manager plans, monitors, and controls the testing activities, while the tester designs tests and decides on the release of the test object`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The test manager plans and organizes the testing and specifies the test cases, while the tester executes the tests`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_31();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_31();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_31();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_31();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_30();
            }
        }
        async function $_istqbuster_a_31() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #31]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following metrics would be MOST useful to monitor during test execution?] `, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Percentage of executed test cases`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Average number of testers involved in the test execution`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Coverage of requirements by source code`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Percentage of test cases already created and reviewed`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_32();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_32();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_32();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_32();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_31();
            }
        }
        async function $_istqbuster_a_32() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #32]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following can affect and be part of the (initial) test planning?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Budget limitations`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Test log`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Failure rate`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Use cases`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_33();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_33();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_33();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_33();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_32();
            }
        }
        async function $_istqbuster_a_33() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #33]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following lists contains only typical exit criteria from testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Reliability measures, test coverage, schedule and status about fixing defect and remaining risks`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Reliability measures, test coverage, degree of tester’s independence and product completeness`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Reliability measures, test coverage, test cost, availability of test environment, time to market and product completeness`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Time to market, remaining defects, tester qualification, availability of testable use cases, test coverage and test cost`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_34();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_34();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_34();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_34();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_33();
            }
        }
        async function $_istqbuster_a_34() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #34]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which one of the following is NOT included in a test summary report?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Defining pass/fail criteria and objectives of testing`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Deviations from the test approach`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Measurements of actual progress against exit criteria`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Evaluation of the quality of the test object`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_35();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_35();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_35();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_35();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_34();
            }
        }
        async function $_istqbuster_a_35() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #35]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]The project develops a (smart) heating thermostat. The control algorithms of the thermostat were modeled as Matlab/Simulink models and run on the internet connected server. The thermostat uses the specifications of the server to trigger the heating valves.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]The test manager has defined the following test strategy/approach in the test plan:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) The acceptance test for the whole system is executed as an experience-based test.`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) The control algorithms on the server are checked against standard of the energy saving regulation.`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) The functional test of the thermostat is performed as risk-based testing.`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) The security tests of data / communication via the internet are executed together with external security experts.`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]What four common types of test strategies/approaches did the test manager implement in the test plan?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Methodical, analytical, reactive, and regression-averse`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Analytical, standard-compliant, consultative, and reactive`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Model-based, methodical, analytical, and consultative`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Regression-averse, consultative, reactive, and methodical`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_36();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_36();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_36();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_36();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_35();
            }
        }
        async function $_istqbuster_a_36() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #36]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which one of the following is the characteristic of a metrics-based approach for test estimation?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Budget which was used by a previous similar test project`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Overall experience collected in interviews with test managers`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Estimation of effort for test automation agreed in the test team`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Average of calculations collected from business experts`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_37();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_37();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_37();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_37();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_36();
            }
        }
        async function $_istqbuster_a_37() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #37]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]As a test manager you are responsible for testing the following parts of requirements:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]R1]-Process anomalies`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]R2]-Synchronization`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]R3]-Approval`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]R4]-Problem solving`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]R5]-Financial data`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]R6]-Diagram data`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]R7]-Changes to the user profile`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Notation: Logical requirement dependencies (A -> B means, that B depends on A):]`, 2);
            gaiman.echo(``);
            gaiman.echo(`             +----+`);
            gaiman.echo(`   +-------->| R3 |`);
            gaiman.echo(`   |         +----+`);
            gaiman.echo(`   |            |`);
            gaiman.echo(`+----+          v`);
            gaiman.echo(`| R1 |     +---------+   +----+`);
            gaiman.echo(`|    | --> |   R2    |-->| R4 |`);
            gaiman.echo(`|    |     |  _||_   |   +----+`);
            gaiman.echo(`|    |     | |    |  |`);
            gaiman.echo(`|    |     | V    V  |   +----+`);
            gaiman.echo(`|    |     | R5   R6 |-->| R7 |`);
            gaiman.echo(`+----+     +---------+   +----+`);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which one of the following options structures the test execution schedule according to the requirement dependencies?:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Methodical, analytical, reactive, and regression-averse`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Analytical, standard-compliant, consultative, and reactive`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Model-based, methodical, analytical, and consultative`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Regression-averse, consultative, reactive, and methodical`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_38();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_38();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_38();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_38();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_37();
            }
        }
        async function $_istqbuster_a_38() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #38]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are testing a new version of software for a coffee machine. The machine can prepare different types of coffee based on four categories. i.e., coffee size, sugar, milk, and syrup. The criteria are as follows:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]-] Coffee size (small, medium, large)`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]-] Sugar (none, 2 unit, 2 units, 3 units, 4 units)`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]-] Milk (yes or no)`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]-] Coffee flavor syrup (no syrup, caramel, hazelnut, vanilla)`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Now you are writing a defect report with the following information:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]-] Title: Low coffee temperature.`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]-] Short summary: When you select coffee with milk, the time for preparing coffee is too long and the temperature of the beverage is too low (less than 40 °C)`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]-] Expected result: The temperature of coffee should be standard (about 75 °C).`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]-] Degree of risk: Medium`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]-] Priority: Normal`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]What valuable information was omitted in the above defect report?:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The actual test results`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Identification of the tested software version`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Status of the defect`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Ideas for improving the test case`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_39();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_39();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_39();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_a_39();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_38();
            }
        }
        async function $_istqbuster_a_39() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #39]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which one of the following is MOST likely to be a benefit of test execution tools?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) It is easy to create regression tests`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) It is easy to maintain version control of test assets`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) It is easy to design tests for security testing`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) It is easy to run regression tests`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_a_40();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_a_40();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_a_40();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_a_40();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_39();
            }
        }
        async function $_istqbuster_a_40() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #40]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which one of the following test tools is mostly suitable for developers rather than testers?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Requirement management tools`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Configuration management tools`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Static analysis tools`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Performance testing tools`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_result_a();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_result_a();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_result_a();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_a_score += 1;
                await $_istqbuster_result_a();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_a_39();
            }
        }
        let $_istqbuster_b_score = 0;
        async function $_istqbuster_b_1() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #1]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following provides the definition of the term test case?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Subset of the value domain of a variable within a component or system in which all values are expected to be treated the same based on the specification`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) A set of preconditions, inputs, actions, expected results and post conditions, developed based on test conditions`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Work products produced during the test process for use in planning, designing, executing, evaluating, and reporting on testing`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) A source to determine an expected result to compare with the actual result of the system under test`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_2();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_2();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_2();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_2();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_1();
            }
        }
        async function $_istqbuster_b_2() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #2]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is a typical objective of testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) To find defects and failures`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) To validate the project plan works as required`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Ensuring of complete testing`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Comparing actual results with expected results`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_3();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_3();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_3();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_3();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_2();
            }
        }
        async function $_istqbuster_b_3() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #3]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is an example of a failure in a car cruise control system?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The developer of the system forgot to rename variables after a cut-and-paste operation`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Unnecessary code that sounds an alarm when reversing was included in the system`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The system stops maintaining a set speed when the radio volume is increased or decreased`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The design specification for the system wrongly states speeds`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_4();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_4();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_4();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_4();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_3();
            }
        }
        async function $_istqbuster_b_4() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #4]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is a defect rather than a root cause in a fitness tracker?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Because the author of the requirements was unfamiliar with the domain of fitness training, he therefore wrongly assumed that users wanted heartbeat in beats per hour`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The tester of the smartphone interface had not been trained in state transition testing, so missed a major defect`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) An incorrect configuration variable implemented for the GPS function could cause location problems during daylight saving times`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Because the designer had never worked on wearable devices before, she as designer of the user interface therefore misunderstood the effects of reflected sunlight`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_5();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_5();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_5();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_5();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_4();
            }
        }
        async function $_istqbuster_b_5() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #5]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]As a result of risk analysis, more testing is being directed to those areas of the system under test where initial testing found more defects than average.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following testing principles is being applied?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Because the author of the requirements was unfamiliar with the domain of fitness training, he therefore wrongly assumed that users wanted heartbeat in beats per hour`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The tester of the smartphone interface had not been trained in state transition testing, so missed a major defect`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) An incorrect configuration variable implemented for the GPS function could cause location problems during daylight saving times`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Because the designer had never worked on wearable devices before, she as designer of the user interface therefore misunderstood the effects of reflected sunlight`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_6();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_6();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_6();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_6();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_5();
            }
        }
        async function $_istqbuster_b_6() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #6]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Given the following test activities and tasks:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]A]) Test design`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]B]) Test implementation`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]C]) Test execution`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]D]) Test completion`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#A6E3A1;]1]) Entering change requests for open defect reports`, 2);
            await gaiman.echo_extra(`[[;#A6E3A1;]2]) Identifying test data to support the test cases`, 2);
            await gaiman.echo_extra(`[[;#A6E3A1;]3]) Prioritizing test procedures and creating test data`, 2);
            await gaiman.echo_extra(`[[;#A6E3A1;]4]) Analyzing discrepancies to determine their cause`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) A-2, B-3, C-4, D-1`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) A-2, B-1, C-3, D-4`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) A-3, B-2, C-4, D-1`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) A-3, B-2, C-1, D-4`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_7();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_7();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_7();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_7();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_6();
            }
        }
        async function $_istqbuster_b_7() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #7]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following BEST describes how value is added by maintaining traceability between the test basis and test artifacts?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Maintenance testing can be fully automated based on changes to the initial requirements`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) It is possible to determine if a new test case has increased coverage of the requirements`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Test managers can identify which testers found the highest severity defects`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Areas that may be impacted by side-effects of a change can be targeted by confirmation testing`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_8();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_8();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_8();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_8();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_7();
            }
        }
        async function $_istqbuster_b_8() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #8]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following qualities is MORE likely to be found in a tester’s mindset rather than in adeveloper’s?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) A tester ́s mindset tends to grow and mature as the tester gains experience`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Ability to see what might go wrong`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Good communication with team members`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Focus on getting all things done`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_9();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_9();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_9();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_9();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_8();
            }
        }
        async function $_istqbuster_b_9() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #9]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Given the following statements about the relationships between software development activities and test activities in the software development lifecycle:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) Each development activity should have a corresponding testing activity`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) Reviewing should start as soon as final versions of documents become available`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) The design and implementation of tests should start during the corresponding development activity`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) Testing activities should start in the early stages of the software development lifecycle`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following CORRECTLY shows which are true and false?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) True – 1, 2; False – 3, 4`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) True – 2, 3; False – 1, 4`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) True – 1, 2, 4; False – 3`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) True – 1, 4; False – 2, 3`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_10();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_10();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_10();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_10();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_9();
            }
        }
        async function $_istqbuster_b_10() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #10]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Given the following statements about the relationships between software development activities and test activities in the software development lifecycle:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) Based on interface specifications`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) Focused on finding failures in communication`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) The test approach uses both functional and structural test types`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following test levels is MOST likely being performed?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Integration testing`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Acceptance testing`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) System testing`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Component testing`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_11();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_11();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_11();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_11();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_10();
            }
        }
        async function $_istqbuster_b_11() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #11]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements about test types and test levels is CORRECT?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Functional and non-functional testing can be performed at system and acceptance test levels, while white-box testing is restricted to component and integration testing`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Functional testing can be performed at any test level, while white-box testing is restricted to component testing`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) It is possible to perform functional, non-functional and white-box testing at any test level`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Functional and non-functional testing can be performed at any test level, while white-box testing is restricted to component and integration testing`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_12();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_12();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_12();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_12();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_11();
            }
        }
        async function $_istqbuster_b_12() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #12]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements BEST compares the purposes of confirmation testing and regression testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The purpose of regression testing is to ensure that all previously run tests still work correctly, while the purpose of confirmation testing is to ensure that any fixes made to one part of the system have not adversely affected other parts`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The purpose of confirmation testing is to check that a previously found defect has been fixed, while the purpose of regression testing is to ensure that no other parts of the system have been adversely affected by the fix`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The purpose of regression testing is to ensure that any changes to one part of the system have not caused another part to fail, while the purpose of confirmation testing is to check that all previously run tests still provide the same results as before`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The purpose of confirmation testing is to confirm that changes to the system were made successfully, while the purpose of regression testing is to run tests that previously failed to ensure that they now work correctly`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_13();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_13();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_13();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_13();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_12();
            }
        }
        async function $_istqbuster_b_13() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #13]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements BEST compares the purposes of confirmation testing and regression testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Impact analysis is used when deciding if a fix to a maintained system is worthwhile`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Impact analysis is used to identify how data should be migrated into the maintained system`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Impact analysis is used to decide which hot fixes are of most value to the user`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Impact analysis is used to determine the effectiveness of new maintenance test cases`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_14();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_14();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_14();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_14();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_13();
            }
        }
        async function $_istqbuster_b_14() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #14]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements CORRECTLY reflects the value of static testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) By introducing reviews, we have found that both the quality of specifications and the time required for development and testing have increased`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Using static testing means we have better control and cheaper defect management due to the ease of detecting defects later in the lifecycle`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Now that we require the use of static analysis, missed requirements have decreased and communication between testers and developers has improved`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Since we started using static analysis, we find coding defects that might have not been found by performing only dynamic testing`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_15();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_15();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_15();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_15();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_14();
            }
        }
        async function $_istqbuster_b_15() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #15]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements on the use of checklists in a formal review is CORRECT?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) As part of the review planning, the reviewers create the checklists needed for the review`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) As part of the issue communication, the reviewers fill in the checklists provided for the review`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) As part of the review meeting, the reviewers create defect reports based on the checklists provided for the review`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) As part of the review initiation, the reviewers receive the checklists needed for the review`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_16();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_16();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_16();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_16();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_15();
            }
        }
        async function $_istqbuster_b_16() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #16]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following CORRECTLY matches the roles and responsibilities in a formal review?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Manager – Decides on the execution of reviews`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Review Leader - Ensures effective running of review meetings`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Scribe – Fixes defects in the work product under review`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Moderator – Monitors ongoing cost-effectiveness`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_17();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_17();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_17();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_17();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_16();
            }
        }
        async function $_istqbuster_b_17() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #17]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]The reviews being used in your organization have the following attributes:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) There is a role of a scribe`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) The purpose is to detect potential defects`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) The review meeting is led by the author`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) Reviewers find potential defects by individual review`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) A review report is produced`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following review types is MOST likely being used?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Informal Review`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Walkthrough`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Technical Review`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Inspection`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_18();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_18();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_18();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_18();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_17();
            }
        }
        async function $_istqbuster_b_18() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #18]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You have been asked to take part in a checklist-based review of the following excerpt from the requirements specification for a library system:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Librarians can:]`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) Register new borrowers`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) Return books from borrowers`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) Accept fines from borrowers`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) Add new books to the system with their ISBN, author and title`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]5]) Remove books from the system`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]6]) Get system responses within 5 seconds`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Borrowers can:]`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]7]) Borrow a maximum of 3 books at one time`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]8]) View the history of books they have borrowed/reserved`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]9]) Be fined for failing to return a book within 3 weeks`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]10]) Get system responses within 3 seconds`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]11]) Borrow a book at no cost for a maximum of 4 weeks`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]12]) Reserve books (if they are on-loan)`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]All users (librarians and borrowers):]`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]13]) Can search for books by ISBN, author, or title`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]14]) Can browse the system catalogue`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]15]) The system shall respond to user requests within 3 seconds`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]16]) The user interface shall be easy-to-use`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]You have been assigned the checklist entry that requires you to review the specification for inconsistencies between individual requirements (i.e., conflicts between requirements).]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following CORRECTLY identifies inconsistencies between pairs of requirements?.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 6-10, 6-15, 7-12`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 6-15, 9-11`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 6-10, 6-15, 9-11`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 6-15, 7-12`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_19();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_19();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_19();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_19();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_18();
            }
        }
        async function $_istqbuster_b_19() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #19]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following provides the BEST description of exploratory testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) A testing practice in which an in-depth investigation of the background of the test object is used to identify potential weaknesses that are examined by test cases`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) An approach to testing whereby the testers dynamically design and execute tests based on their knowledge, exploration of the test item and the results of previous tests`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) An approach to test design in which test activities are planned as uninterrupted sessions of test analysis and design, often used in conjunction with checklist-based testing`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Testing based on the tester's experience, knowledge, and intuition`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_20();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_20();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_20();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_20();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_19();
            }
        }
        async function $_istqbuster_b_20() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #20]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following BEST matches the descriptions with the different categories of test techniques?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) Coverage is measured based on a selected structure of the test object`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) The processing within the test object is checked`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) Tests are based on defects’ likelihood and their distribution`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) Deviations from the requirements are checked`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]5]) User stories are used as the test basis`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Using notation for the following 4 options:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]Black]) - Black-box test techniques`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]White]) - White-box test techniques`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]Experience]) - Experience-based test techniques`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Black – 4, 2 White    – 1, 2; Experience – 3`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Black – 3 White       – 1, 2; Experience – 4, 2`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Black – 4 White       – 1, 2; Experience – 3, 2`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Black – 1, 3, 2 White – 2; Experience    – 4`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_21();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_21();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_21();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_21();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_20();
            }
        }
        async function $_istqbuster_b_21() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #21]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]A fitness app measures the number of steps that are walked each day and provides feedback to encourage the user to keep fit.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]The feedback for different numbers of steps should be:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) Up to 1000 - Couch Potato!`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) Above 1000, up to 2000 - Lazy Bones!`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) Above 2000, up to 4000 - Getting There!`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) Above 4000, up to 6000 - Not Bad!`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) Above 6000 - Way to Go!`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following sets of test inputs would achieve the BEST equivalence partition coverage?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 0, 2000, 200, 3000, 4000`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 1000, 201, 4000, 4001, 6000`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 123, 2345, 3456, 4567, 2678`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 666, 999, 2222, 255, 6666`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_22();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_22();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_22();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_22();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_21();
            }
        }
        async function $_istqbuster_b_22() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #22]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]A daily radiation recorder for plants produces a sunshine score based on a combination of the number of hours a plant is exposed to the sun (below 3 hours, 3 to 6 hours or above 6 hours) and the average intensity of the sunshine (very low, low, medium, high).]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Given the following test cases:]`, 2);
            gaiman.echo(`     +--------+-----------+-------+`);
            gaiman.echo(`     | Hours  | Intensity | Score |`);
            gaiman.echo(`+-------------+-----------+-------+`);
            gaiman.echo(`| T1 | 1.5    | v. low    | 10    |`);
            gaiman.echo(`+-------------+-----------+-------+`);
            gaiman.echo(`| T2 | 7.0    | medium    | 60    |`);
            gaiman.echo(`+-------------+-----------+-------+`);
            gaiman.echo(`| T3 | 0.5    | v. low    | 10    |`);
            gaiman.echo(`+-------------+-----------+-------+`);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]What is the minimum number of additional test cases that are needed to ensure full coverage of ALL VALID INPUT equivalence partitions?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 1`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 2`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 3`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 4`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_23();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_23();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_23();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_23();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_22();
            }
        }
        async function $_istqbuster_b_23() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #23]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]A smart home app measures the average temperature in the house over the previous week and provides feedback to the occupants on their environmental friendliness based on this temperature.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]The feedback for different average temperature ranges (to the nearest °C) should be:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) Up to 10°C - Icy Cool!`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) 11°C to 15°C - Chilled Out!`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) 16°C to 19°C - Cool Man!`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) 20°C to 22°C - Too Warm!`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]•]) Above 22°C - Hot & Sweaty!`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Using BVA (only Min- and Max values), which of the following sets of test inputs provides the highest level of boundary coverage?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 0°C, 21°C, 2°C, 22°C, 23°C`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 9°C, 2°C, 29°C, 23°C, 200°C`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 10°C, 26°C, 29°C, 22°C, 23°C`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 14°C, 2°C, 28°C, 29°C, 21°C, 22°C`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_24();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_24();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_24();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_24();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_23();
            }
        }
        async function $_istqbuster_b_24() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #24]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Decision table testing is being performed on a speeding fine system. Two test cases have already been generated for rules R1 and R4, which are shown below:]`, 2);
            gaiman.echo(``);
            gaiman.echo(`             +----------------------------+----+----+`);
            gaiman.echo(`             | Rules                      | R1 | R4 |`);
            gaiman.echo(`+------------+----------------------------+----+----+`);
            gaiman.echo(`|            | Speed > 50                 | T  | F  |`);
            gaiman.echo(`| Conditions +----------------------------+----+----+`);
            gaiman.echo(`|            | School Zone                | T  | F  |`);
            gaiman.echo(`+------------+----------------------------+----+----+`);
            gaiman.echo(`|            | $250 Dine                  | F  | F  |`);
            gaiman.echo(`| Actions    +----------------------------+----+----+`);
            gaiman.echo(`|            | Driving license Withdrawal | T  | F  |`);
            gaiman.echo(`+------------+----------------------------+----+----+`);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Decision table testing is being performed on a speeding fine system. Two test cases have already been generated for rules R1 and R4, which are shown below:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Given the following additional test cases:]`, 2);
            gaiman.echo(``);
            gaiman.echo(`                  +----------------------------+-----+-----+-----+-----+`);
            gaiman.echo(`                  | Rules                      | DT1 | DT2 | DT3 | DT4 |`);
            gaiman.echo(`+-----------------+----------------------------+-----+-----+-----+-----+`);
            gaiman.echo(`|                 | Speed > 50                 | 55  | 44  | 66  | 77  |`);
            gaiman.echo(`| Input           +----------------------------+-----+-----+-----+-----+`);
            gaiman.echo(`|                 | School Zone                | T   | T   | T   | F   |`);
            gaiman.echo(`+-----------------+----------------------------+-----+-----+-----+-----+`);
            gaiman.echo(`|                 | $250 Dine                  | F   | F   | F   | T   |`);
            gaiman.echo(`| Expected Result +----------------------------+-----+-----+-----+-----+`);
            gaiman.echo(`|                 | Driving license Withdrawal | T   | F   | T   | F   |`);
            gaiman.echo(`+-----------------+----------------------------+-----+-----+-----+-----+`);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which two of the additional test cases would achieve full coverage of the complete decision table (when combined with the test cases that have already been generated for rules R1 and R4)?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) DT1, DT2`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) DT2, DT3`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) DT2, DT4`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) DT3, DT4`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_25();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_25();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_25();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_25();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_24();
            }
        }
        async function $_istqbuster_b_25() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #25]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Given the following state model of a battery charger software:]`, 2);
            gaiman.echo(``);
            gaiman.echo(`             +---------+     +------+`);
            gaiman.echo(`             |  WAIT   | --> | OFF  |`);
            gaiman.echo(`             |         | <-- |      |`);
            gaiman.echo(`             +---------+     +------+`);
            gaiman.echo(`                |  ^`);
            gaiman.echo(`                v  |`);
            gaiman.echo(`             +---------+`);
            gaiman.echo(`             | TRICKLE |`);
            gaiman.echo(`             |         |`);
            gaiman.echo(`             +---------+`);
            gaiman.echo(`                |  ^`);
            gaiman.echo(`                v  |`);
            gaiman.echo(`+------+     +---------+     +------+`);
            gaiman.echo(`|  R7  | --> | CHARGE  | --> | HIGH |`);
            gaiman.echo(`|      | <-- |         | <-- |      |`);
            gaiman.echo(`+------+     +---------+     +------+`);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following sequences of transitions provides the highest level of transition coverage for the model?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) OFF  → WAIT    → OFF     → WAIT   → TRICKLE →`, 2);
            await gaiman.echo_extra(`                    CHARGE  → HIGH    → CHARGE → LOW`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) WAIT → TRICKLE → WAIT    → OFF    → WAIT →`, 2);
            await gaiman.echo_extra(`                    TRICKLE → CHARGE  → LOW    → CHARGE`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) HIGH → CHARGE  → LOW     → CHARGE → TRICKLE →`, 2);
            await gaiman.echo_extra(`                    WAIT    → TRICKLE → WAIT   → TRICKLE`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) WAIT → TRICKLE → CHARGE  → HIGH   → CHARGE →`, 2);
            await gaiman.echo_extra(`                    TRICKLE → WAIT    → OFF    → WAIT`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_26();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_26();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_26();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_26();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_25();
            }
        }
        async function $_istqbuster_b_26() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #26]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements BEST describes how test cases are derived from a use case?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Test cases are created to exercise defined basic, exceptional and error behaviors performed by the system under test in collaboration with actors`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Test cases are derived by identifying the components included in the use case and creating integration tests that exercise the interactions of these components`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Test cases are generated by analyzing the interactions of the actors with the system to ensure the user interfaces are easy to use`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Test cases are derived to exercise each of the decision points in the business process flows of the use case, to achieve 100% decision coverage of these flows`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_27();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_27();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_27();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_27();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_26();
            }
        }
        async function $_istqbuster_b_27() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #27]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following descriptions of statement coverage is CORRECT?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Statement coverage is a measure of the number of lines of source code exercised by tests`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Statement coverage is a measure of the proportion of executable statements in the source code exercised by tests`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Statement coverage is a measure of the percentage of lines of source code (without comments) exercised by tests`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Statement coverage is a measure of the number of executable statements in the source code exercised by tests`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_28();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_28();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_28();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_28();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_27();
            }
        }
        async function $_istqbuster_b_28() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #28]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following descriptions of statement coverage is CORRECT?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Decision coverage is a measure of the percentage of possible paths through the source code exercised by tests`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Decision coverage is a measure of the percentage of business flows through the component exercised by tests`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Decision coverage is a measure of the ‘if’ statements in the code that are exercised with both the true and false outcomes`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Decision coverage is a measure of the proportion of decision outcomes in the source code exercised by tests`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_29();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_29();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_29();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_29();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_28();
            }
        }
        async function $_istqbuster_b_29() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #29]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following BEST describes the concept behind error guessing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Error guessing requires you to imagine you are the user of the test object and guess mistakes the user could make interacting with it`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Error guessing involves using your personal experience of development and the mistakes you made as a developer`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Error guessing involves using your knowledge and experience of defects found in the past and typical mistakes made by developers`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Error guessing requires you to rapidly duplicate the development task to identify the sort of mistakes a developer might make`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_30();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_30();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_30();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_30();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_29();
            }
        }
        async function $_istqbuster_b_30() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #30]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following BEST explains a benefit of independent testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The use of an independent test team allows project management to assign responsibility for the quality of the final deliverable to the test team, so ensuring everyone is aware that quality is the test team’s overall responsibility`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) If a test team external to the organization can be afforded, then there are distinct benefits in terms of this external team not being so easily swayed by the delivery concerns of project management and the need to meet strict delivery deadlines`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) An independent test team can work totally separately from the developers, need not be distracted with changing project requirements, and can restrict communication with the developers to defect reporting through the defect management system`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) When specifications contain ambiguities and inconsistencies, assumptions are made on their interpretation, and an independent tester can be useful in questioning those assumptions and the interpretation made by the developer`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_31();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_31();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_31();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_31();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_30();
            }
        }
        async function $_istqbuster_b_31() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #31]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following tasks is MOST LIKELY to be performed by the test manager?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Write test summary reports based on the information gathered during testing`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Review tests developed by others`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Prepare and acquire test data`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Analyze, review, and assess requirements, specifications, and models for testability`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_32();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_32();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_32();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_32();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_31();
            }
        }
        async function $_istqbuster_b_32() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #32]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Given the following examples of entry and exit criteria:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) The original testing budget of $30,000 plus contingency of $7,000 has been spent`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) 96% of planned tests for the drawing package have been executed and the remaining tests are now out of scope`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) The trading performance test environment has been designed, set-up and verified`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) Current status is no outstanding critical defects and two high-priority ones`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]5]) The autopilot design specifications have been reviewed and reworked`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]6]) The tax rate calculation component has passed unit testing.`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following BEST categorizes them as entry and exit criteria:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Entry criteria – 5, 6; Exit criteria – 1, 2, 3, 4`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Entry criteria – 2, 3, 6; Exit criteria – 1, 4, 2`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Entry criteria – 1, 3; Exit criteria – 2, 4, 2, 6`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Entry criteria – 3, 2, 6; Exit criteria – 1, 2, 4`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_33();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_33();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_33();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_33();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_32();
            }
        }
        async function $_istqbuster_b_33() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #33]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Given the following priorities and dependencies for these test cases:]`, 2);
            gaiman.echo(``);
            gaiman.echo(`+-----------+----------+----------------+----------------+`);
            gaiman.echo(`| Test Case | Priority |   Technical    |   Logical      |`);
            gaiman.echo(`|           |          | dependency on: | dependency on: |`);
            gaiman.echo(`+-----------+----------+----------------+----------------+`);
            gaiman.echo(`| TC1       | High     | TC4            |                |`);
            gaiman.echo(`+-----------+----------+----------------+----------------+`);
            gaiman.echo(`| TC2       | Low      |                |                |`);
            gaiman.echo(`+-----------+----------+----------------+----------------+`);
            gaiman.echo(`| TC3       | High     |                | TC4            |`);
            gaiman.echo(`+-----------+----------+----------------+----------------+`);
            gaiman.echo(`| TC4       | Medium   |                |                |`);
            gaiman.echo(`+-----------+----------+----------------+----------------+`);
            gaiman.echo(`| TC5       | Low      |                | TC2            |`);
            gaiman.echo(`+-----------+----------+----------------+----------------+`);
            gaiman.echo(`| TC6       | Medium   | TC5            |                |`);
            gaiman.echo(`+-----------+----------+----------------+----------------+`);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following test execution schedules BEST considers the priorities and technical and logical dependencies?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) TC1 – TC3 – TC4 – TC6 – TC2 – TC5`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) TC4 – TC3 – TC1 – TC2 – TC5 – TC6`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) TC4 – TC1 – TC3 – TC5 – TC6 – TC2`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) TC4 – TC2 – TC5 – TC1 – TC3 – TC6`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_34();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_34();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_34();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_34();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_33();
            }
        }
        async function $_istqbuster_b_34() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #34]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements about test estimation approaches is CORRECT?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) With the metrics-based approach, the estimate is based on test measures from the project and so this estimate is only available after the testing starts`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) With the expert-based approach, a group of expert users identified by the client recommends the necessary testing budget`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) With the expert-based approach, the test managers responsible for the different testing activities predict the expected testing effort`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) With the metrics-based approach, an average of the testing costs recorded from several past projects is used as the testing budget`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_35();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_35();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_35();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_35();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_34();
            }
        }
        async function $_istqbuster_b_35() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #35]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following BEST defines risk level?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Risk level is calculated by adding together the probabilities of all problem situations and the financial harm that results from them`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Risk level is estimated by multiplying the likelihood of a threat to the system by the chance that the threat will occur and will result in financial damage`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Risk level is determined by a combination of the probability of an undesirable event and the expected impact of that event`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Risk level is the sum of all potential hazards to a system multiplied by the sum of all potential losses from that system`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_36();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_36();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_36();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_36();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_35();
            }
        }
        async function $_istqbuster_b_36() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #36]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is MOST likely to be an example of a PRODUCT risk?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The expected security features may not be supported by the system architecture`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The developers may not have time to fix all the defects found by the test team`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The test cases may not provide full coverage of the specified requirements`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The performance test environment may not be ready before the system is due for delivery`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_37();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_37();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_37();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_37();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_36();
            }
        }
        async function $_istqbuster_b_37() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #37]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is LEAST likely to be an example of product risk analysis CORRECTLY influencing the testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The potential impact of security flaws has been identified as being particularly high, so security testing has been prioritized ahead of some other testing activities`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Testing has found the quality of the network module to be higher than expected, so additional testing will be performed in that area`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The users had problems with the user interface of the previous system, so additional usability testing is planned for the replacement system`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The time needed to load web pages is crucial to the success of the new website, so an expert in performance testing has been employed for this project`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_38();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_38();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_38();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_38();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_37();
            }
        }
        async function $_istqbuster_b_38() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #38]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are performing system testing of a train reservation system. Based on the test cases performed, you have noticed that the system occasionally reports that no trains are available, although this should be the case. You have provided the developers with a summary of the defect and the version of the tested system. They recognize the urgency of the defect and are now waiting for you to provide further details.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]In addition to the information already provided, the following additional information is given:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) Degree of impact (severity) of the defect`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) Identification of the test object`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) Details of the test environment`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) Urgency/priority to fix`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]5]) Actual results`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]6]) Reference to test case specification`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of this additional information is most useful to include in the defect report?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 1, 2, 6`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 1, 4, 2, 6`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 2, 3, 4, 2`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 3, 2, 6`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_39();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_39();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_b_39();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_39();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_38();
            }
        }
        async function $_istqbuster_b_39() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #39]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Given the following test activities and test tools:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) Performance measurement and dynamic analysis`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) Test execution and logging`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) Management of testing and testware`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) Test design`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]A]) Code coverage tools`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]B]) Dynamic analysis tools`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]C]) Test data preparation tools`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]D]) Defect management tools`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following BEST matches the activities and tools?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 1 – B, 2 – C, 3 – D, 4 – A`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 1 – B, 2 – A, 3 – C, 4 – D`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 1 – B, 2 – A, 3 – D, 4 – C`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 1 – A, 2 – B, 3 – D, 4 – C`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_b_40();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_b_40();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_b_40();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_b_40();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_39();
            }
        }
        async function $_istqbuster_b_40() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #40]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is MOST likely to be used as a reason for using a pilot project to introduce a tool into an organization?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The need to evaluate how the tool fits with existing processes and practices and determining what would need to change`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The need to evaluate the test automation skills and training, mentoring and coaching needs of the testers who will use the tool`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The need to evaluate whether the tool provides the required functionality and does not duplicate existing test tools`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The need to evaluate the tool vendor in terms of the training and other support they provide`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_b_score += 1;
                await $_istqbuster_result_b();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_result_b();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_result_b();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_result_b();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_b_40();
            }
        }
        let $_istqbuster_c_score = 0;
        async function $_istqbuster_c_1() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #1]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]What is quality?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Activities focused on providing confidence that quality requirements will be fulfilled`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The degree to which a component or system satisfies the stated and implied needs of its various stakeholders`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The degree to which a component or system protects information and data so that persons or other components or systems have the degree of access appropriate to their types and levels of authorization`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The total costs incurred on quality activities and issues and often split into prevention costs, appraisal costs, internal failure costs and external failure costs`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_2();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_2();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_2();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_2();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_1();
            }
        }
        async function $_istqbuster_c_2() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #2]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is a typical test objective?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Preventing defects`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Repairing defects`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Comparing actual results to expected results`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Analyzing the cause of failure`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_3();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_3();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_3();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_3();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_2();
            }
        }
        async function $_istqbuster_c_3() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #3]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]A phone ringing momentarily distracts a programmer, causing the programmer to improperly program the logic that checks the upper boundary of an input variable. Later, during system testing, a tester notices that this input field accepts invalid input values. The improperly coded logic for the upper boundary check is:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The root-cause`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The failure`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The error`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The defect`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_4();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_4();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_4();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_4();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_3();
            }
        }
        async function $_istqbuster_c_4() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #4]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]A product owner says that your role as a tester on an Agile team is to catch all the bugs before the end of each iteration. Which of the following is a testing principle that could be used to respond to this (false) statement?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Defect clustering`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Testing shows the presence of defects`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Absence of error fallacy`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Root cause analysis`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_5();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_5();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_5();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_5();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_4();
            }
        }
        async function $_istqbuster_c_5() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #5]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Programmers often write and execute unit tests against code which they have written. During this self-testing activity, which of the following is a tester mindset that programmers should adopt to perform this unit testing effectively?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Good communication skills`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Code coverage`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Evaluating code defects`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Attention to detail`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_6();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_6();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_6();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_6();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_5();
            }
        }
        async function $_istqbuster_c_6() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #6]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Consider the following testing activities:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1]) Selecting regression tests`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2]) Evaluating completeness of test execution`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3]) Identifying which user stories have open defect reports`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4]) Evaluating whether the number of tests for each requirement is consistent with the level of product risk`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Consider the following ways traceability can help testing:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]A]) Degree of impact (severity) of the defect`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]B]) Identification of the test object`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]C]) Details of the test environment`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]D]) Urgency/priority to fix`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following best matches the testing activity with how traceability can assist that activity?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 1D, 2B, 3C, 4A`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 1B, 2D, 3A, 4C`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 1D, 2C, 3A, 4B`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 1D, 2B, 3A, 4C`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_7();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_7();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_7();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_7();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_6();
            }
        }
        async function $_istqbuster_c_7() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #7]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]A tester participated in a discussion about proposed database structure. The tester identified a potential performance problem related to certain common user searches. This possible problem was explained to the development team. Which of the following is a testing contribution to success that BEST matches this situation?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Enabling required tests to be identified at an early stage`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Ensuring processes are carried out properly`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Reducing the risk of fundamental design defects`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Reducing the risk of untestable functionality`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_8();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_8();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_8();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_8();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_7();
            }
        }
        async function $_istqbuster_c_8() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #8]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is an example of a task that can be carried out as part of the test process?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Analyzing a defect`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Designing test data`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Assigning a version to a test item`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Writing a user story`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_9();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_9();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_9();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_9();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_8();
            }
        }
        async function $_istqbuster_c_9() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #9]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are running a performance test with the objective of finding possible network bottlenecks in interfaces between components of a system. Which of the following statements describes this test?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) A functional test during the integration test level`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) A non-functional test during the integration test level`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) A functional test during the component test level`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) A non-functional test during the component test level`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_10();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_10();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_10();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_10();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_9();
            }
        }
        async function $_istqbuster_c_10() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #10]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following statements is true?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Impact analysis is useful for confirmation testing during maintenance testing`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Confirmation testing is useful for regression testing during system design`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Impact analysis is useful for regression testing during maintenance testing`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Confirmation testing is useful for impact analysis during maintenance testing`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_11();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_11();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_11();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_11();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_10();
            }
        }
        async function $_istqbuster_c_11() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #11]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Consider the following types of defects that a test level might focus on:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]a]) Defects in separately testable modules or objects`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Not focused on identifying defects`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]c]) Defects in interfaces and interactions`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]d]) Defects in the whole test object`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following list correctly matches test levels from the Foundation syllabus with the defect focus options given above?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 1 = performance test; 2 = component test; 3 = system test; 4 = acceptance test`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 1 = component test; 2 = acceptance test; 3 = system test; 4 = integration test`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 1 = component test; 2 = acceptance test; 3 = integration test; 4 = system test`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 1 = integration test; 2 = system test; 3 = component test; 4 = acceptance test`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_12();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_12();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_12();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_12();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_11();
            }
        }
        async function $_istqbuster_c_12() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #12]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]A mass market operating system software product is designed to run on any PC hardware with an x86-family processor. You are running a set of tests to look for defects related to support of the various PCs that use such a processor and to build confidence that important PC brands will work. What type of test are you performing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Performance test`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Processor test`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Functional test`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Portability test`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_13();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_13();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_13();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_13();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_12();
            }
        }
        async function $_istqbuster_c_13() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #13]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]During an Agile development effort, a product owner discovers a previously unknown regulatory requirement that applies to most of the user stories within a particular epic. The user stories are updated to provide for the necessary changes in software behavior. The programmers on the team are modifying the code appropriately. As a tester on the team, what types of tests will you run?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Confirmation tests`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Regression tests`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Functional tests`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Change-related tests`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_14();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_14();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_14();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_14();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_13();
            }
        }
        async function $_istqbuster_c_14() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #14]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]In a formal review, what is the role name for the participant who runs an inspection meeting?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Facilitator`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Programmer`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Author`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Project manager`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_15();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_15();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_15();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_15();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_14();
            }
        }
        async function $_istqbuster_c_15() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #15]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are reading a user story in the product backlog to prepare for a meeting with the product owner and a developer, noting potential defects as you go. Which of the following statements is true about this activity?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) It is not a static test, because static testing involves execution of the test object`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) It is not a static test, because static testing is always performed using a tool`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) It is a static test, because any defects you find could be found cheaper during dynamic testing`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) It is a static test because static testing does not involve execution of the test object`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_16();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_16();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_16();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_16();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_15();
            }
        }
        async function $_istqbuster_c_16() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #16]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]During a period of intensive project overtime, a system architecture document is sent to various project participants, announcing a previously unplanned technical review to occur in one week. No adjustments are made to the participants’ list of assigned tasks. Based on this information alone, which of the following is a factor for review success that is MISSING?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Appropriate review type`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Adequate time to prepare`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Sufficient metrics to evaluate the author`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Well-managed review meeting`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_17();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_17();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_17();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_17();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_16();
            }
        }
        async function $_istqbuster_c_17() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #17]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are working as a tester on an Agile team and have participated in over two dozen user story refinement sessions with the product owner and the developers on the team at the start of each iteration. As the reviews have gotten more effective at detecting defects in user stories and the product owner more proficient at correcting those defects, you and the team notice that the team’s velocity, as shown in your burndown charts, has started to increase. Which of the following is a benefit of static testing that is MOST DIRECTLY related to the team’s increased velocity?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Increasing total cost of quality`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Reducing testing cost`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Increasing development productivity`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Reducing total cost of quality`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_18();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_18();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_18();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_18();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_17();
            }
        }
        async function $_istqbuster_c_18() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #18]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are working on a video game development project, using Agile methods. It is based on Greek mythology and history, and players can play key roles in scenarios such as the battles between the Greeks and Trojans.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Consider the following user story and its associated acceptance criteria:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]As a player, I want to be able to acquire the Rod of Midas (a new magic object), so that I can turn objects and other players into gold]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]AC1]) The Rod must work on any object or player, no matter what size, which can be touched anywhere by the player holding the Rod`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]AC2]) Holding the Rod does not change the player holding it into gold`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]AC3]) Any object or player touched by the Rod transforms completely into gold within one millisecond`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]AC4]) The Rod appears as shown in Prototype O.W.RoM`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]AC5]) The transformation starts at the point of contact with the Rod and moves at a rate of one meter per millisecond`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are participating in a checklist-based review session of this user story.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]This user story and its associated acceptance criteria contain which of the following typical defects identified by static testing in this type of work product?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Deviation from standards`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Contradiction`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Security vulnerability`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Coverage gaps`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_19();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_19();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_19();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_19();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_18();
            }
        }
        async function $_istqbuster_c_19() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #19]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]What is decision coverage?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The coverage of condition outcomes`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Decision coverage is a synonym for statement coverage`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The coverage of executable statements`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The coverage of decision outcomes`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_20();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_20();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_20();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_19();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_18();
            }
        }
        async function $_istqbuster_c_20() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #20]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Prior to an iteration planning session, you are studying a user story and its acceptance criteria, deriving test conditions and associated test cases from the user story as a way of applying the principle of early QA and test. What test technique are you applying?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) White-box`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Black-box`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Experience-based`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Error guessing`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_21();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_21();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_21();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_21();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_20();
            }
        }
        async function $_istqbuster_c_21() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #21]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is a true statement about exploratory testing?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) More experienced testers who have tested similar applications and technologies are likely to do better than less experienced testers at exploratory testing`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Exploratory testing does not identify any additional tests beyond those that would result from formal test techniques`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) The time required to complete an exploratory testing session cannot be predicted in advance`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Exploratory testing can involve the use of black-box techniques but not white-box techniques`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_22();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_22();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_22();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_22();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_21();
            }
        }
        async function $_istqbuster_c_22() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #22]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are testing a mobile app that allows customers to access and manage their bank accounts. You are running a test suite that involves evaluating each screen and each field on each screen against a general list of user interface best practices, derived from a popular book on the topic, that maximize attractiveness, ease-of-use, and accessibility for such apps. Which of the following options BEST categorizes the test technique you are using?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Specification-based`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Exploratory`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Checklist-based`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Error guessing`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_23();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_23();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_23();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_23();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_22();
            }
        }
        async function $_istqbuster_c_23() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #23]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Consider a mobile app that allows customers to access and manage their bank accounts. A user story has just been added to the set of features that checks customers’ social media accounts and bank records to give personalized greetings on birthdays and other personal milestones. Which of the following test techniques could a PROGRAMMER use during a unit test of the code to ensure that coverage of situations when the greetings ARE supposed to occur and when the greetings ARE NOT supposed to occur?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Statement testing`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Exploratory testing`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) State transition testing`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Decision testing`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_24();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_24();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_24();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_24();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_23();
            }
        }
        async function $_istqbuster_c_24() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #24]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]A batch application has been in production unchanged for over two years. It runs overnight once a month to produce statements that will be e-mailed to customers. For each customer, the application goes through every account and lists every transaction on that account in the last month. It uses a nested-loop structure to process customers (outer loop), each customer’s accounts (middle loop), and each account’s transactions (inner loop).]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]One night, the batch application terminates prematurely, failing to e-mail statements to some customers, when it encounters a customer with one account for which no transactions occurred in the last month. This is a very unusual situation and has not occurred in the years since this application was placed in production.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]While fixing the defect, a programmer asks you to recommend test techniques that are effective against this kind of defect. Which of the following test techniques would most likely have been able to detect the underlying defect?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Decision testing`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Statement testing`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Checklist-based testing`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Error guessing`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_25();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_25();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_25();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_25();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_24();
            }
        }
        async function $_istqbuster_c_25() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #25]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are testing an unattended gasoline pump that only accepts credit cards. Once the credit card is validated, the pump nozzle placed into the tank, and the desired grade selected, the customer enters the desired amount of fuel in gallons using the keypad. The keypad only allows the entry of digits. Fuel is sold in tenths (0.1) of a gallon, up to 50.0 gallons.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is a minimum set of desired amounts that covers the equivalence partitions for this input?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 0.0, 20.0, 60.0`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 0.0, 0.1, 50.0`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 0.0, 0.1, 50.0, 70.0`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) -0.1, 0.0, 0.1, 49.9, 50.0, 50.1`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_26();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_26();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_26();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_26();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_24();
            }
        }
        async function $_istqbuster_c_26() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #26]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are testing an e-commerce system that sells cooking supplies such as spices, flour, and other items in bulk. The units in which the items are sold are either grams (for spices and other expensive items) or kilograms (for flour and other inexpensive items). Regardless of the units, the smallest valid order amount is 0.5 units (e.g., half a gram of cardamom pods) and the largest valid order amount is 25.0 units (e.g., 2 kilograms of sugar). The precision of the unit’s field is 0.1 units.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is a set of input values that cover the boundary values with two-point boundary values for this field?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 0.3, 10.0, 28.0`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 0.4, 0.5, 0.6, 24, 9, 2, 0, 2.1`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 0.4, 0.5, 2.0 25.1`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 0.5, 0.6, 24.9, 2.0`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_27();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_27();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_27();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_27();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_26();
            }
        }
        async function $_istqbuster_c_27() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #27]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Consider the following decision table for the portion of an online airline reservation system that allows frequent flyers to redeem points for reward travel:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]Condition])                1 2 3`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]Account/password okay])    N Y Y`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]Sufficient points Action]) - N Y`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]Show flight history])      N Y Y`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]Allow reward travel])      N N Y`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Suppose that there are two equivalence partitions for the condition where “Account/password okay” is not true, one where the account is invalid and another where the account is valid, but the password is invalid. Suppose that there is only one equivalence partition corresponding to the condition where “Account/password okay” is true, where both the account and password are valid.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]If you want to design tests to cover the equivalence partitions for “Account/password okay” and also for this portion of the decision table, what is the minimum number of tests required?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 2`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 3`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 4`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 9`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_28();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_28();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_28();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_28();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_27();
            }
        }
        async function $_istqbuster_c_28() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #28]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Consider the following state transition diagram for a credit-card only, unattended gasoline pump:]`, 2);
            gaiman.echo(``);
            gaiman.echo(`Insert credit card [invalid]/Error message                                       `);
            gaiman.echo(`      | |                                                                        `);
            gaiman.echo(`      | |                  +->Insert credit card [valid]/Select grade message-+  `);
            gaiman.echo(`      | v                  |                                                  |  `);
            gaiman.echo(`     +----------------------+                                                 v  `);
            gaiman.echo(`#--->| Waiting for customer |<-----Cancel or timeout/<--+-----------------------+`);
            gaiman.echo(`     +----------------------+      Goodbye message      | Waiting for fuel type |`);
            gaiman.echo(`       ^                ^                               +-----------------------+`);
            gaiman.echo(`       |                |                                                      | `);
            gaiman.echo(`       |                |                                                      v `);
            gaiman.echo(`Customer finished/      |                                      Push grade button/`);
            gaiman.echo(` Print receipt          |                                  Start pumping message `);
            gaiman.echo(`       |                +--- Cancel or timeout/----------+                     | `);
            gaiman.echo(`       |                      Goodbye message            |                     v `);
            gaiman.echo(`       +---------+                                      +-----------------------+`);
            gaiman.echo(`       | Pumping |                                      | Waiting for pumping   |`);
            gaiman.echo(`       +---------+<------------------Customer pumps/<---+-----------------------+`);
            gaiman.echo(`                                  Pumping started message                        `);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Assume that you want to develop the minimum number of tests to cover each transition in the state transition diagram. Assume further that each test must start at the beginning state, waiting for customer, and each test ends when a transition arrives at the beginning state. How many tests do you need?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 4`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 7`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 1`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Infinite`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_29();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_29();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_29();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_29();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_28();
            }
        }
        async function $_istqbuster_c_29() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #29]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are testing an e-commerce system that sells cooking supplies such as spices, flour, and other items in bulk. The units in which the items are sold are either grams (for spices and other expensive items) or kilograms (for flour and other inexpensive items). Regardless of the units, the smallest valid order amount is 0.5 units (e.g., half a gram of cardamom pods) and the largest valid order amount is 25.0 units (e.g., 2 kilograms of sugar). The precision of the units’ field is 0.1 units.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is a MINIMAL set of input values that cover the equivalence partitions for this field?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 10.0, 28.0`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 0.4, 0.5, 2.0, 2.1`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 0.2, 0.9, 29.5`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 12.3`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_30();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_30();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_30();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_30();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_29();
            }
        }
        async function $_istqbuster_c_30() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #30]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are working as a tester on an online banking system. Availability is considered one of the top products (quality) risks for the system. You find a reproducible failure that results in customers losing their connections to the bank Web site when transferring funds between common types of accounts and being unable to reconnect for between three and five minutes.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following would be a good summary for a defect report for this failure, one that captures both the essence of the failure and its impact on stakeholders?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Web server logs show error 0x44AB27 when running test 07.005, which is not an expected error message in /tmp filesystem`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Developers have introduced major availability defect which will seriously upset our customers`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Performance is slow and reliability flaky under load`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Typical funds-transfer transaction results in termination of customer session, with a delay in availability when attempting to reconnect`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_31();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_31();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_31();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_31();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_30();
            }
        }
        async function $_istqbuster_c_31() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #31]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are testing a mobile app that allows users to find a nearby restaurant, based on the type of food they want to eat. Consider the following list of test cases, priorities (smaller number is high priority), and dependencies, in the following format:]`, 2);
            gaiman.echo(``);
            gaiman.echo(`+-----------+---------------------+----------+------------+`);
            gaiman.echo(`| Test case | Test condition      | Priority | Logical    |`);
            gaiman.echo(`| number    | covered             |          | dependency |`);
            gaiman.echo(`+-----------+---------------------+----------+------------+`);
            gaiman.echo(`| 01.001    | Select type of food |    3     | none       |`);
            gaiman.echo(`+-----------+---------------------+----------+------------+`);
            gaiman.echo(`| 01.002    | Select restaurant   |    2     | 01.001     |`);
            gaiman.echo(`+-----------+---------------------+----------+------------|`);
            gaiman.echo(`| 01.003    | Get directions      |    1     | 01.002     |`);
            gaiman.echo(`+-----------+---------------------+----------+------------|`);
            gaiman.echo(`| 01.004    | Call restaurant     |    1     | 01.002     |`);
            gaiman.echo(`+-----------+-------------------- +----------+------------+`);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is a possible test execution schedule that considers both priorities and dependencies?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) 01.001, 01.002, 01.003, 01.005,`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) 01.001, 01.002, 01.004, 01.003,`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) 01.003, 01.004, 01.002, 01.001,`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) 01.001, 01.002, 01.004, 01.005,`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_32();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_32();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_32();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_32();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_31();
            }
        }
        async function $_istqbuster_c_32() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #32]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is a common test metric often used to monitor BOTH test preparation and test execution?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Test case status`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Defect find/fix rates`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Test environment preparation`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Estimated cost to find the next defect`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_33();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_33();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_33();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_33();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_32();
            }
        }
        async function $_istqbuster_c_33() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #33]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following are two factors that can be used to determine the level of risk?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Testing and development`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Dynamic and reactive`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Statement and decision`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Likelihood and impact`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_34();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_34();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_34();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_34();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_33();
            }
        }
        async function $_istqbuster_c_34() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #34]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are working as a project manager on an in-house banking software project. To prevent rework and excessive find/fix/retest cycles, the following process has been put in place for resolving a defect once it is found in the test lab:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]1.]) The assigned developer finds and fixes the defect, then creates an experimental build`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]2.]) A peer developer reviews, unit tests, and confirmation tests the defect fix on his/her desktop`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]3.]) A tester – usually the one who found the defect – confirmation tests the defect fix in the development environment`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]4.]) Once a day, a new release with all confirmed defect fixes included, is installed in the test environment`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]5.]) The same tester from step 3 confirmation tests the defect fix in the test environment`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Nevertheless, a large number of defects which the testers confirmed as fixed in the development environment (in step 3) are somehow failing confirmation testing in the test environment, with the resulting rework and cycle time outcomes. You have the highest confidence in your testers and have ruled out mistakes or omissions in step 3.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following is the MOST likely part of the process to check next?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) The activity of developers, who may not be adequately testing in step 2`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) The activity of testers, who may be confused about what to test in step 5`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Configuration management, which may not be maintaining the integrity of the product in step 4`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) The activity of developers, who may not be fixing defects properly in step 1`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_35();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_35();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_35();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_35();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_34();
            }
        }
        async function $_istqbuster_c_35() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #35]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are engaged in planning a test effort for a new mobile banking application. As part of estimation, you first meet with the proposed testers and others on the project. The team is well- coordinated and has already worked on similar projects. To verify the resulting estimate, you then refer to some industry averages for testing effort and costs on similar projects, published by a reputable consultant.]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which statement accurately describes your estimation approach?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) A simultaneous expert-based and metrics-based approach`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Primarily an expert-based approach, augmented with a metrics-based approach`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Primarily a metrics-based approach, augmented with an expert-based approach`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Primarily planning poker, checked by velocity from burndown charts`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_36();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_36();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_36();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_36();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_35();
            }
        }
        async function $_istqbuster_c_36() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #36]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]During a project following Agile methods, you find a discrepancy between the developer’s interpretation of an acceptance criteria and the product owner’s interpretation, which you bring up during a user story refinement session. Which of the following is a benefit of test independence exemplified by this situation?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Recognizing different kinds of failures`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Taking primary responsibility for quality`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Removing a defect early`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Challenging stakeholder assumptions`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_37();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_37();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_37();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_37();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_36();
            }
        }
        async function $_istqbuster_c_37() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #37]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You are defining the process for carrying out product risk analysis as part of each iteration on an Agile project. Which of the following is the proper place to document this process in a test plan?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Scope of testing`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Approach of testing`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Metrics of testing`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Configuration management of the test object`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_38();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_38();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_38();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_38();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_37();
            }
        }
        async function $_istqbuster_c_38() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #38]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Consider the following list of undesirable outcomes that could occur on a mobile app development effort:]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]A.]) Incorrect totals on screens`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]B.]) Change to acceptance criteria during acceptance testing`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]C.]) Users find the soft keyboard too hard to use with your app`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]D.]) System responds too slowly to user input during search string entry`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]E.]) Testers not allowed to report test results in daily standup meetings`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following properly classifies these outcomes as project and product risks?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Product risks: B, E;       Project risks: A, C, D`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Product risks: A, C, D;    Project risks: B, E`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Product risks: A, C, D, E  Project risks: B`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Product risks: A, C        Project risks: B, D, E`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_39();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_39();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_39();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_c_39();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_38();
            }
        }
        async function $_istqbuster_c_39() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #39]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]You have just completed a pilot project for a regression testing tool. You understand the tool much better and have tailored your testing process to it. You have standardized an approach to using the tool and its associated work products. Which of the following is a typical test automation pilot project goal that remains to be carried out?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Learn more details about the tool`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) See how the tool would fit with existing processes and practices`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Decide on standard ways of using, managing, storing, and maintaining the tool and the test assets`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Assess whether the benefits will be achieved at reasonable cost`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                await $_istqbuster_c_40();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_c_40();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_c_40();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_c_40();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_39();
            }
        }
        async function $_istqbuster_c_40() {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#FFC773;]Question #40]`, 2);
            await gaiman.echo_extra(`[[;#F9E2AF;]Which of the following tools is most useful for reporting test metrics?]`, 2);
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]a]) Test management tool`, 2);
            await gaiman.echo_extra(`[[;#94E2D5;]b]) Static analysis tool`, 2);
            await gaiman.echo_extra(`[[;#89B4FA;]c]) Coverage tool`, 2);
            await gaiman.echo_extra(`[[;#F5C2E7;]d]) Model-Based testing tools`, 2);
            gaiman.echo(``);
            let $_answer = await gaiman.ask(`[[;#94E2D5;]Select ONE option.] `);
            gaiman.prompt(`Answer> `);
            if ($$__m = String($_answer).match(/a/i), !!$$__m) {
                $_istqbuster_c_score += 1;
                await $_istqbuster_result_c();
            } else if ($$__m = String($_answer).match(/b/i), !!$$__m) {
                await $_istqbuster_result_c();
            } else if ($$__m = String($_answer).match(/c/i), !!$$__m) {
                await $_istqbuster_result_c();
            } else if ($$__m = String($_answer).match(/d/i), !!$$__m) {
                await $_istqbuster_result_c();
            } else {
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_istqbuster_c_40();
            }
        }
        async function $_istqbuster_result_a() {
            gaiman.echo(``);
            if ($_istqbuster_a_score >= 26) {
                await gaiman.echo_extra(`[[;#A6E3A1;]You win]`, 20);
                await gaiman.echo_extra(`[[;#F5C2E7;]result:]`, 30);
                gaiman.echo($_istqbuster_a_score);
                await gaiman.echo_extra(`[[;#F38BA8;]Congratulations, you are on the right track, keep practicing!]`, 30);
                gaiman.echo(``);
                await $_restart();
            } else {
                gaiman.echo(``);
                await gaiman.echo_extra(`[[;#F38BA8;]You loose]`, 20);
                await gaiman.echo_extra(`[[;#F5C2E7;]result:]`, 30);
                gaiman.echo($_istqbuster_a_score);
                await gaiman.echo_extra(`[[;#F38BA8;]Keep trying, Rome wasn't built in a day!]`, 30);
                gaiman.echo(``);
                await $_restart();
            }
        }
        async function $_istqbuster_result_b() {
            gaiman.echo(``);
            if ($_istqbuster_b_score >= 26) {
                await gaiman.echo_extra(`[[;#A6E3A1;]You win]`, 20);
                await gaiman.echo_extra(`[[;#F5C2E7;]result:]`, 30);
                gaiman.echo($_istqbuster_b_score);
                await gaiman.echo_extra(`[[;#F38BA8;]Congratulations, you are on the right track, keep practicing!]`, 30);
                gaiman.echo(``);
                await $_restart();
            } else {
                gaiman.echo(``);
                await gaiman.echo_extra(`[[;#F38BA8;]You loose]`, 20);
                await gaiman.echo_extra(`[[;#F5C2E7;]result:]`, 30);
                gaiman.echo($_istqbuster_b_score);
                await gaiman.echo_extra(`[[;#F38BA8;]Keep trying, Rome wasn't built in a day!]`, 30);
                gaiman.echo(``);
                await $_restart();
            }
        }
        async function $_istqbuster_result_c() {
            gaiman.echo(``);
            if ($_istqbuster_c_score >= 26) {
                await gaiman.echo_extra(`[[;#A6E3A1;]You win]`, 20);
                await gaiman.echo_extra(`[[;#F5C2E7;]result:]`, 30);
                gaiman.echo($_istqbuster_c_score);
                await gaiman.echo_extra(`[[;#F38BA8;]Congratulations, you are on the right track, keep practicing!]`, 30);
                gaiman.echo(``);
                await $_restart();
            } else {
                gaiman.echo(``);
                await gaiman.echo_extra(`[[;#F38BA8;]You loose]`, 20);
                await gaiman.echo_extra(`[[;#F5C2E7;]result:]`, 30);
                gaiman.echo($_istqbuster_c_score);
                await gaiman.echo_extra(`[[;#F38BA8;]Keep trying, Rome wasn't built in a day!]`, 30);
                gaiman.echo(``);
                await $_restart();
            }
        }
        async function $_restart() {
            await gaiman.echo_extra(`Let's keep practicing,type the exam letter that you want:`, 20);
            let $_confirm = await gaiman.ask(`[[;#F38BA8;]A], [[;#94E2D5;]B] or [[;#89B4FA;]C] `);
            if ($$__m = String($_confirm).match(/a/i), !!$$__m) {
                gaiman.echo(``);
                await gaiman.echo_extra(`[[;#F38BA8;]Starting ISTQB foundation level exam A]`, 30);
                $_istqbuster_a_score = 0;
                await $_istqbuster_a_1();
            } else if ($$__m = String($_confirm).match(/b/i), !!$$__m) {
                gaiman.echo(``);
                await gaiman.echo_extra(`[[;#94E2D5;]Starting ISTQB foundation level exam B]`, 30);
                $_istqbuster_b_score = 0;
                await $_istqbuster_b_1();
            } else if ($$__m = String($_confirm).match(/c/i), !!$$__m) {
                gaiman.echo(``);
                await gaiman.echo_extra(`[[;#89B4FA;]Starting ISTQB foundation level exam C]`, 30);
                $_istqbuster_c_score = 0;
                await $_istqbuster_c_1();
            } else {
                gaiman.echo(``);
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_restart();
            }
        }
        async function $_restart_music_wizard() {
            await gaiman.echo_extra(`[[;#94E2D5;]Do you want to activate it?]`, 30);
            let $_music = await gaiman.ask(`[[;#A6E3A1;]yes]/[[;#F38BA8;]no]? `);
            if ($$__m = String($_music).match(/yes/i), !!$$__m) {
                await $_start_music();
                gaiman.echo(``);
            } else if ($$__m = String($_music).match(/y/i), !!$$__m) {
                await $_start_music();
                gaiman.echo(``);
            } else if ($$__m = String($_music).match(/no/i), !!$$__m) {
                gaiman.echo(``);
            } else if ($$__m = String($_music).match(/n/i), !!$$__m) {
                gaiman.echo(``);
            } else {
                gaiman.echo(``);
                await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
                await $_restart_music_wizard();
            }
        }
        async function $_start_music() {
            gaiman.echo(``);
            audio.play();
        }
        let $_greetings = '   [[;#F5C2E7;]_____, _________  _ __]               \r\n  [[;#F5C2E7;]( /(   (  /  /   )( /  )        _/_]   \r\n   [[;#F5C2E7;]/  `.   /  /_  /  /--< , , (   /  _  _]\r\n [[;#F5C2E7;]_/_(___)_/  (__\\/  /___/(_/_/_)_(__(/_/ (_]\r\n                 [[;#F5C2E7;]\\_]\r\n [[;#BAC2DE;]Practice your ISTQB certification exams]\r\n\r';
        gaiman.echo($_greetings);
        await gaiman.sleep(100);
        await gaiman.echo_extra(`[[;#94E2D5;]Welcome, we recommend relaxing music to concentrate]`, 30);
        await gaiman.echo_extra(`[[;#94E2D5;]Do you want to activate it?]`, 30);
        gaiman.echo(``);
        let $_music = await gaiman.ask(`[[;#A6E3A1;]yes]/[[;#F38BA8;]no]? `);
        if ($$__m = String($_music).match(/yes/i), !!$$__m) {
            await $_start_music();
            gaiman.echo(``);
        } else if ($$__m = String($_music).match(/y/i), !!$$__m) {
            await $_start_music();
            gaiman.echo(``);
        } else if ($$__m = String($_music).match(/no/i), !!$$__m) {
            gaiman.echo(``);
        } else if ($$__m = String($_music).match(/n/i), !!$$__m) {
            gaiman.echo(``);
        } else {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
            await $_restart_music_wizard();
        }
        await gaiman.echo_extra(`[[;#F5C2E7;]Rules:]`, 40);
        gaiman.echo(``);
        await gaiman.echo_extra(`[[;#94E2D5;]1]) Each correct question gives you 1 point`, 40);
        await gaiman.echo_extra(`[[;#94E2D5;]2]) If you get 26 questions or more correct you pass`, 40);
        await gaiman.echo_extra(`[[;#94E2D5;]3]) You have [[;#F5C2E7;]60] minutes`, 40);
        await gaiman.echo_extra(`[[;#94E2D5;]4]) Manage your time like a real exam`, 40);
        gaiman.echo(``);
        await gaiman.echo_extra(`[[;#89B4FA;]Good luck]`, 40);
        gaiman.echo(``);
        await gaiman.echo_extra(`[[;#F9E2AF;]Which exam would you like to practice?]`, 40);
        gaiman.echo(``);
        await gaiman.echo_extra(`Type the exam letter that you want:`, 20);
        let $_confirm = await gaiman.ask(`[[;#F38BA8;]A], [[;#94E2D5;]B] or [[;#89B4FA;]C] `);
        if ($$__m = String($_confirm).match(/a/i), !!$$__m) {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#F38BA8;]Starting ISTQB foundation level exam A]`, 30);
            await $_istqbuster_a_1();
        } else if ($$__m = String($_confirm).match(/b/i), !!$$__m) {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#94E2D5;]Starting ISTQB foundation level exam B]`, 30);
            await $_istqbuster_b_1();
        } else if ($$__m = String($_confirm).match(/c/i), !!$$__m) {
            gaiman.echo(``);
            await gaiman.echo_extra(`[[;#89B4FA;]Starting ISTQB foundation level exam C]`, 30);
            await $_istqbuster_c_1();
        } else {
            await gaiman.echo_extra(`[[;#F5C2E7;]Looks like you typed an incorrect letter or word...]`, 30);
            await $_restart();
        }
    } catch (e) {
        gaiman.error(e);
    }
}
