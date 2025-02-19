import TEMPLATES from './templates';
import createStackFilter from '../create-stack-filter';
import { getCallsiteForMethod } from '../get-callsite';
import renderTemplate from '../../utils/render-template';
import renderCallsiteSync from '../../utils/render-callsite-sync';
import { RUNTIME_ERRORS } from '../types';
import getRenderers from '../../utils/get-renderes';
import util from 'util';

const ERROR_SEPARATOR = '\n\n';

class ProcessTemplateInstruction {
    constructor (processFn) {
        this.processFn = processFn;
    }
}

// Errors
export class GeneralError extends Error {
    constructor (...args) {
        const code     = args.shift();
        const template = TEMPLATES[code];

        super(renderTemplate(template, ...args));

        Object.assign(this, { code, data: args });
        Error.captureStackTrace(this, GeneralError);
    }

    static isGeneralError (arg) {
        return arg instanceof GeneralError;
    }
}

export class TestCompilationError extends Error {
    constructor (originalError) {
        const template     = TEMPLATES[RUNTIME_ERRORS.cannotPrepareTestsDueToError];
        const errorMessage = originalError.toString();

        super(renderTemplate(template, errorMessage));

        Object.assign(this, {
            code: RUNTIME_ERRORS.cannotPrepareTestsDueToError,
            data: [errorMessage],
        });

        // NOTE: stack includes message as well.
        this.stack = renderTemplate(template, originalError.stack);
    }
}

export class APIError extends Error {
    constructor (callsite, code, ...args) {
        let template = TEMPLATES[code];

        template = APIError._prepareTemplateAndArgsIfNecessary(template, args);

        const rawMessage = renderTemplate(template, ...args);

        super(renderTemplate(TEMPLATES[RUNTIME_ERRORS.cannotPrepareTestsDueToError], rawMessage));

        Object.assign(this, { code, data: args });

        // NOTE: `rawMessage` is used in error substitution if it occurs in test run.
        this.rawMessage = rawMessage;

        if (typeof callsite === 'object')
            this.callsite = callsite;
        else
            this.callsite   = getCallsiteForMethod(callsite);

        // NOTE: We need property getters here because callsite can be replaced by an external code.
        // See https://github.com/DevExpress/testcafe/blob/v1.0.0/src/compiler/test-file/formats/raw.js#L22
        // Also we can't use an ES6 getter for the 'stack' property, because it will create a getter on the class prototype
        // that cannot override the instance property created by the Error parent class.
        const renderers = getRenderers(this.callsite);

        Object.defineProperties(this, {
            'stack': {
                get: () => this._createStack(renderers.noColor),
            },

            'coloredStack': {
                get: () => this._createStack(renderers.default),
            },
        });
    }

    _createStack (renderer) {
        const renderedCallsite = renderCallsiteSync(this.callsite, {
            renderer:    renderer,
            stackFilter: createStackFilter(Error.stackTraceLimit),
        });

        if (!renderedCallsite)
            return this.message;

        return this.message + ERROR_SEPARATOR + renderedCallsite;
    }

    static _prepareTemplateAndArgsIfNecessary (template, args) {
        const lastArg = args.pop();

        if (lastArg instanceof ProcessTemplateInstruction)
            template = lastArg.processFn(template);
        else
            args.push(lastArg);

        return template;
    }
}

export class ClientFunctionAPIError extends APIError {
    constructor (methodName, instantiationCallsiteName, code, ...args) {
        args.push(new ProcessTemplateInstruction(template => template.replace(/\{#instantiationCallsiteName\}/g, instantiationCallsiteName)));

        super(methodName, code, ...args);
    }
}

export class CompositeError extends Error {
    constructor (errors) {
        super(errors.map(({ message }) => message).join(ERROR_SEPARATOR));

        this.stack = errors.map(({ stack }) => stack).join(ERROR_SEPARATOR);
        this.code  = RUNTIME_ERRORS.compositeArgumentsError;
    }
}

export class ReporterPluginError extends GeneralError {
    constructor ({ name, method, originalError }) {
        const code          = RUNTIME_ERRORS.uncaughtErrorInReporter;
        const preparedStack = ReporterPluginError._prepareStack(originalError);

        super(code, method, name, preparedStack);
    }

    static _prepareStack (err) {
        if (!err?.stack) {
            const inspectedObject = util.inspect(err);

            return `No stack trace is available for a raised error.\nRaised error object inspection:\n${inspectedObject}`;
        }

        return err.stack;
    }

}

export class TimeoutError extends GeneralError {
    constructor () {
        super(RUNTIME_ERRORS.timeLimitedPromiseTimeoutExpired);
    }
}

export class BrowserConnectionError extends GeneralError {
    constructor (...args) {
        super(RUNTIME_ERRORS.browserConnectionError, ...args);
    }
}

export class RequestRuntimeError extends APIError {
    constructor (methodName, code, ...args) {
        super(methodName, code, ...args);
    }
}

export class SkipJsErrorsArgumentApiError extends APIError {
    constructor (code, ...args) {
        super('skipJsErrors', code, ...args);
    }
}
