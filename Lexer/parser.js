"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Parser = void 0;
exports.parse = parse;
const lexer_1 = require("./lexer");
const precedence = { '|': 1, '&': 2, '??': 3, '==': 4, '!=': 4, '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 };
const opTypes = { EqualEqual: '==', NotEqual: '!=', Less: '<', LessEqual: '<=', Greater: '>', GreaterEqual: '>=', Nullish: '??', Pipe: '|', Ampersand: '&', Plus: '+', Minus: '-', Multiply: '*', Divide: '/', Percent: '%' };
const assignmentOperators = { Equal: '=', PlusEqual: '+=', MinusEqual: '-=', MultiplyEqual: '*=', DivideEqual: '/=', PercentEqual: '%=', PipeEqual: '|=', AmpersandEqual: '&=' };
class Parser {
    tokens;
    pos = 0;
    softExpressionIndents = 0;
    constructor(tokens) {
        this.tokens = tokens;
    }
    get current() { return this.tokens[this.pos]; }
    is(type, value) { const t = this.current; return t.type === type && (value === undefined || t.value === value); }
    take(type, message = `Expected ${type}`) { if (!this.is(type))
        this.fail(message); return this.tokens[this.pos++]; }
    value(token) { return token.value; }
    match(type, value) { if (!this.is(type, value))
        return false; this.pos++; return true; }
    fail(message) { throw new SyntaxError(`${message} at ${this.current.line}:${this.current.column}`); }
    loc(token) { return { line: token.line, column: token.column }; }
    identifier() {
        const token = this.take('Identifier', 'Expected identifier');
        return { name: String(this.value(token)), loc: this.loc(token) };
    }
    propertyName() {
        if (this.is('Identifier') || this.is('Keyword')) {
            const token = this.tokens[this.pos++];
            return { name: String(this.value(token)), loc: this.loc(token) };
        }
        if (this.is('String')) {
            const token = this.take('String');
            return { name: String(this.value(token)), loc: this.loc(token) };
        }
        if (this.is('Number')) {
            const token = this.take('Number');
            return { name: String(this.value(token)), loc: this.loc(token) };
        }
        return this.identifier();
    }
    separators() { while (this.match('Newline') || this.match('Comma')) { } }
    objectSeparators() { while (this.match('Newline') || this.match('Comma') || this.match('Indent') || this.match('Dedent')) { } }
    parenthesisSeparators() { while (this.match('Newline') || this.match('Indent') || this.match('Dedent')) { } }
    parse() {
        const body = [];
        const topSeparators = () => { while (this.match('Newline') || this.match('Comma') || this.match('Dedent')) { } };
        topSeparators();
        while (!this.is('EOF')) {
            body.push(this.statement());
            topSeparators();
        }
        return body;
    }
    parseExpressionOnly() {
        const value = this.expression();
        while (this.match('Newline')) { }
        if (!this.is('EOF'))
            this.fail('Unexpected token after expression');
        return value;
    }
    statement() {
        if (this.match('Keyword', 'import'))
            return this.importStatement();
        if (this.match('Keyword', 'export')) {
            const isDefault = this.match('Keyword', 'default');
            const declaration = this.statement();
            if (!['Import', 'Variable', 'Destructure', 'ArrayDestructure', 'FunctionDeclaration', 'TypeDeclaration', 'ConstructorDeclaration'].includes(declaration.kind))
                this.fail('export must precede a declaration');
            return { kind: 'Export', declaration, default: isDefault };
        }
        if (this.match('Keyword', 'let') || this.match('Keyword', 'const')) {
            const mutable = this.value(this.tokens[this.pos - 1]) === 'let';
            if (this.match('LeftBrace')) {
                const bindings = [];
                const patternSeparators = () => { while (this.match('Newline') || this.match('Indent') || this.match('Dedent')) { } };
                patternSeparators();
                while (!this.is('RightBrace')) {
                    bindings.push(this.identifier());
                    patternSeparators();
                    if (this.match('Comma'))
                        patternSeparators();
                    else if (!this.is('RightBrace'))
                        this.fail("Expected ',' or '}' in object destructuring");
                }
                this.take('RightBrace');
                this.take('Equal', "Expected '=' after object destructuring");
                return { kind: 'Destructure', bindings, mutable, initializer: this.expression() };
            }
            if (this.match('LeftBracket')) {
                const bindings = [];
                let index = 0;
                while (!this.is('RightBracket')) {
                    if (this.match('Comma')) {
                        index++;
                        continue;
                    }
                    const rest = this.match('Ellipsis');
                    const binding = this.identifier();
                    bindings.push({ ...binding, index, rest });
                    if (rest && !this.is('RightBracket'))
                        this.fail('A rest binding must be the last element');
                    if (!rest)
                        index++;
                    if (!this.match('Comma') && !this.is('RightBracket'))
                        this.fail("Expected ',' or ']' in array destructuring");
                }
                this.take('RightBracket');
                this.take('Equal', "Expected '=' after array destructuring");
                return { kind: 'ArrayDestructure', bindings, mutable, initializer: this.expression() };
            }
            const { name, loc } = this.identifier();
            const type = this.match('Colon') ? this.type() : undefined;
            let initializer;
            if (this.match('Equal')) {
                const multiline = this.match('Newline');
                if (multiline)
                    this.take('Indent', 'Expected an indented initializer');
                initializer = this.expression();
            }
            if (!initializer && !type)
                this.fail('A variable needs a type or initializer');
            if (!mutable && !initializer)
                this.fail('const requires an initializer');
            return { kind: 'Variable', name, loc, mutable, type, initializer };
        }
        if (this.match('Keyword', 'fun')) {
            const { name, loc } = this.identifier();
            const genericParameters = this.match('Less') ? this.genericParameters() : [];
            const params = this.parameters(), returnType = this.match('Colon') ? this.type() : undefined;
            this.take('Equal', "Expected '=' before function body");
            const body = this.is('Keyword', 'match')
                ? [{ kind: 'Return', value: this.expression() }]
                : this.block();
            return {
                kind: 'FunctionDeclaration', name, loc,
                generics: genericParameters.map(item => item.name),
                genericLocs: genericParameters.map(item => item.loc),
                genericConstraints: genericParameters.map(item => item.constraint),
                genericDefaults: genericParameters.map(item => item.defaultType),
                params, returnType, body
            };
        }
        if (this.match('Keyword', 'type')) {
            const { name, loc } = this.identifier();
            const genericParameters = this.match('Less') ? this.genericParameters() : [];
            this.take('Equal', "Expected '=' in type declaration");
            const indented = this.match('Newline');
            if (indented && this.is('Indent') && this.tokens[this.pos + 1]?.type !== 'Pipe' && this.tokens[this.pos + 1]?.type !== 'Ampersand')
                this.pos++;
            const value = this.type();
            if (indented) {
                this.separators();
                if (this.is('Dedent'))
                    this.take('Dedent');
            }
            return { kind: 'TypeDeclaration', name, loc, generics: genericParameters.map(item => item.name), genericLocs: genericParameters.map(item => item.loc), genericConstraints: genericParameters.map(item => item.constraint), genericDefaults: genericParameters.map(item => item.defaultType), value };
        }
        if (this.match('Keyword', 'constructor')) {
            const { name, loc } = this.identifier();
            const genericParameters = this.match('Less') ? this.genericParameters() : [];
            const inheritedType = this.match('Colon')
                ? this.type()
                : { kind: 'ObjectType', members: [] };
            this.take('LeftBrace', "Expected '{' before constructor overloads");
            const overloads = [];
            const methods = [];
            this.objectSeparators();
            while (!this.is('RightBrace') && !this.is('EOF')) {
                this.take('Keyword', "Expected anonymous 'fun' constructor overload");
                if (this.value(this.tokens[this.pos - 1]) !== 'fun')
                    this.fail("Expected anonymous 'fun' constructor overload");
                if (!this.is('LeftParen')) {
                    const method = this.propertyName();
                    const methodGenericParameters = this.match('Less') ? this.genericParameters() : [];
                    const params = this.parameters();
                    const returnType = this.match('Colon') ? this.type() : undefined;
                    this.take('Equal', "Expected '=' before constructor method body");
                    methods.push({ kind: 'FunctionDeclaration', name: method.name, loc: method.loc, generics: methodGenericParameters.map(item => item.name), genericLocs: methodGenericParameters.map(item => item.loc), genericConstraints: methodGenericParameters.map(item => item.constraint), genericDefaults: methodGenericParameters.map(item => item.defaultType), params, returnType, body: this.block() });
                    this.objectSeparators();
                    continue;
                }
                const params = this.parameters();
                const returnType = this.match('Colon') ? this.type() : undefined;
                this.take('Equal', "Expected '=' before constructor body");
                overloads.push({ kind: 'Function', params, returnType, body: this.block() });
                this.objectSeparators();
            }
            this.take('RightBrace');
            if (!overloads.length)
                this.fail('A constructor needs at least one anonymous function');
            return { kind: 'ConstructorDeclaration', name, loc, generics: genericParameters.map(item => item.name), genericLocs: genericParameters.map(item => item.loc), genericConstraints: genericParameters.map(item => item.constraint), genericDefaults: genericParameters.map(item => item.defaultType), inheritedType, overloads, methods };
        }
        if (this.match('Keyword', 'return'))
            return { kind: 'Return', value: this.is('Newline') || this.is('Dedent') || this.is('EOF') ? undefined : this.expression() };
        if (this.match('Keyword', 'break'))
            return { kind: 'Break', loc: this.loc(this.tokens[this.pos - 1]) };
        if (this.is('Identifier') && assignmentOperators[this.tokens[this.pos + 1]?.type]) {
            const { name, loc } = this.identifier(), operatorToken = this.current, operator = assignmentOperators[operatorToken.type];
            this.pos++;
            return { kind: 'ExpressionStatement', expression: { kind: 'Assignment', name, loc, operatorLoc: this.loc(operatorToken), operator, value: this.expression() } };
        }
        if (this.match('Keyword', 'if')) {
            const condition = this.expression(), consequent = this.block();
            this.separators();
            const alternate = this.match('Keyword', 'else') ? this.block() : undefined;
            return { kind: 'If', condition, consequent, alternate };
        }
        if (this.match('Keyword', 'while'))
            return { kind: 'While', condition: this.expression(), body: this.block() };
        if (this.match('Keyword', 'for')) {
            const mutable = this.match('Keyword', 'let') || !this.match('Keyword', 'const'), { name: binding, loc } = this.identifier();
            this.take('Keyword', "Expected 'of'");
            const iterable = this.expression();
            return { kind: 'ForOf', binding, loc, mutable, iterable, body: this.block() };
        }
        const expression = this.expression();
        const assignmentOperator = assignmentOperators[this.current.type];
        if (assignmentOperator) {
            const operatorToken = this.current;
            this.pos++;
            if (expression.kind === 'Member')
                return { kind: 'ExpressionStatement', expression: { kind: 'MemberAssignment', object: expression.object, property: expression.property, propertyLoc: expression.loc, loc: this.loc(operatorToken), operator: assignmentOperator, value: this.expression() } };
            if (expression.kind === 'Index')
                return { kind: 'ExpressionStatement', expression: { kind: 'MemberAssignment', object: expression.object, index: expression.index, loc: this.loc(operatorToken), operator: assignmentOperator, value: this.expression() } };
            this.fail('Only variables and object properties can be assigned here');
        }
        return { kind: 'ExpressionStatement', expression };
    }
    importStatement() {
        let defaultImport;
        let defaultImportLoc;
        const namedImports = [];
        const namedImportLocs = [];
        const namedImportList = () => {
            this.parenthesisSeparators();
            while (!this.is('RightBrace')) {
                const ident = this.identifier();
                namedImports.push(ident.name);
                namedImportLocs.push(ident.loc);
                this.parenthesisSeparators();
                if (this.match('Comma'))
                    this.parenthesisSeparators();
                else if (!this.is('RightBrace'))
                    this.fail("Expected ',' or '}' after imported name");
            }
            this.take('RightBrace', "Expected '}' after imported names");
        };
        if (this.match('LeftBrace')) {
            namedImportList();
        }
        else {
            const ident = this.identifier();
            defaultImport = ident.name;
            defaultImportLoc = ident.loc;
            if (this.match('Comma')) {
                this.take('LeftBrace', "Expected '{' before named imports");
                namedImportList();
            }
        }
        this.parenthesisSeparators();
        this.take('Keyword', "Expected 'from' after import names");
        const moduleToken = this.take('String', "Expected 'juno', 'juno:node', or 'types' module name");
        const module = String(this.value(moduleToken));
        if (!defaultImport && namedImports.length === 0)
            this.fail('Import must name at least one binding');
        return { kind: 'Import', module, defaultImport, defaultImportLoc, namedImports, namedImportLocs };
    }
    block() {
        this.take('Newline', 'Expected a newline before indented block');
        while (this.match('Newline')) { }
        this.take('Indent', 'Expected an indented block');
        const body = [];
        this.separators();
        while (!this.is('Dedent') && !this.is('EOF')) {
            body.push(this.statement());
            this.separators();
        }
        this.take('Dedent');
        return body;
    }
    matchPattern() {
        const patterns = [this.matchPatternAtom()];
        while (this.match('Pipe'))
            patterns.push(this.matchPatternAtom());
        return patterns.length === 1 ? patterns[0] : { kind: 'PatternUnion', patterns, loc: patterns[0].loc };
    }
    matchPatternAtom() {
        if (this.match('String') || this.match('Number') || this.match('BigInt')) {
            const token = this.tokens[this.pos - 1];
            return { kind: 'PatternLiteral', value: this.value(token), loc: this.loc(token) };
        }
        if (this.match('Keyword', 'true') || this.match('Keyword', 'false') || this.match('Keyword', 'null')) {
            const token = this.tokens[this.pos - 1];
            const value = this.value(token);
            return { kind: 'PatternLiteral', value: value === 'true' ? true : value === 'false' ? false : null, loc: this.loc(token) };
        }
        if (this.match('LeftBrace')) {
            const start = this.tokens[this.pos - 1];
            const properties = [];
            this.objectSeparators();
            while (!this.is('RightBrace')) {
                const property = this.propertyName();
                const pattern = this.match('Colon') ? this.matchPatternAtom() : undefined;
                properties.push({ name: property.name, pattern, loc: property.loc });
                this.parenthesisSeparators();
                if (this.match('Comma'))
                    this.objectSeparators();
                else if (!this.is('RightBrace'))
                    this.fail("Expected ',' or '}' in match object pattern");
            }
            this.take('RightBrace');
            return { kind: 'PatternObject', properties, loc: this.loc(start) };
        }
        const token = this.take('Identifier', 'Expected a literal, type, variable, or object pattern');
        return { kind: 'PatternIdentifier', name: String(this.value(token)), nullable: this.match('Question'), loc: this.loc(token) };
    }
    matchExpression(token) {
        const value = this.expression();
        this.take('Newline', 'Expected a newline after match value');
        this.take('Indent', 'Expected indented match cases');
        const cases = [];
        this.separators();
        while (!this.is('Dedent') && !this.is('EOF')) {
            if (this.match('Keyword', 'case')) {
                const caseToken = this.tokens[this.pos - 1];
                const pattern = this.matchPattern();
                const guard = this.match('Keyword', 'when') ? this.expression() : undefined;
                cases.push({ pattern, guard, body: this.block(), loc: this.loc(caseToken) });
            }
            else if (this.match('Keyword', 'default')) {
                const defaultToken = this.tokens[this.pos - 1];
                if (cases.some(item => !item.pattern))
                    this.fail('A match expression can only have one default case');
                cases.push({ body: this.block(), loc: this.loc(defaultToken) });
            }
            else
                this.fail("Expected 'case' or 'default' in match expression");
            this.separators();
        }
        this.take('Dedent');
        return { kind: 'Match', value, cases, loc: this.loc(token) };
    }
    parameters() {
        this.take('LeftParen');
        const params = [];
        let optionalSeen = false, restSeen = false;
        while (!this.is('RightParen')) {
            const ellipsis = this.is('Ellipsis');
            const rest = ellipsis || this.is('Dot') && this.tokens[this.pos + 1]?.type === 'Dot' && this.tokens[this.pos + 2]?.type === 'Dot';
            if (rest)
                this.pos += ellipsis ? 1 : 3;
            if (restSeen)
                this.fail('A rest parameter must be the last parameter');
            const { name, loc } = this.identifier(), type = this.match('Colon') ? this.type() : undefined, defaultValue = this.match('Equal') ? this.expression() : undefined;
            if (rest && defaultValue !== undefined)
                this.fail('A rest parameter cannot have a default value');
            if (rest && !type)
                this.fail('A rest parameter must have an array type');
            if (rest && type && type.kind !== 'NamedType' && type.kind !== 'ArrayType' && !(type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray')))
                this.fail('A rest parameter must have an array type or an array-constrained generic type');
            if (!rest && defaultValue !== undefined)
                optionalSeen = true;
            else if (!rest && optionalSeen)
                this.fail('Parameters with default values must follow parameters without default values');
            params.push({ name, loc, type, defaultValue, rest });
            restSeen ||= rest;
            if (!this.match('Comma') && !this.is('RightParen'))
                this.fail("Expected ',' or ')' in parameters");
        }
        this.take('RightParen');
        return params;
    }
    genericParameters() {
        const parameters = [];
        let defaultSeen = false;
        do {
            const parameter = this.identifier();
            const constraint = this.match('Identifier', 'is') ? this.type() : undefined;
            const defaultType = this.match('Equal') ? this.type() : undefined;
            if (defaultType)
                defaultSeen = true;
            else if (defaultSeen)
                this.fail('Required generic parameters must precede defaulted generic parameters');
            parameters.push({ ...parameter, constraint, defaultType });
        } while (this.match('Comma'));
        this.take('Greater');
        return parameters;
    }
    type(stopAtConditionalQuestion = false) {
        while (this.match('Newline') || this.match('Indent')) { }
        if (this.is('Pipe') || this.is('Ampersand')) {
            const operator = this.current.type;
            const parts = [];
            while (this.is(operator)) {
                this.pos++;
                while (this.match('Newline') || this.match('Indent')) { }
                parts.push(this.typeAtom());
                while (this.match('Newline')) { }
            }
            const kind = operator === 'Pipe' ? 'UnionType' : 'IntersectionType';
            return parts.length === 1 ? parts[0] : { kind, types: parts };
        }
        const optional = () => {
            let value = this.typeAtom();
            if (!stopAtConditionalQuestion && this.match('Question'))
                value = { kind: 'UnionType', types: [value, { kind: 'NamedType', name: 'null' }] };
            return value;
        };
        let left = optional();
        while (this.is('Pipe') || this.is('Ampersand') || this.is('Newline') && (this.tokens[this.pos + 1]?.type === 'Pipe' || this.tokens[this.pos + 1]?.type === 'Ampersand') || this.is('Newline') && this.tokens[this.pos + 1]?.type === 'Indent' && (this.tokens[this.pos + 2]?.type === 'Pipe' || this.tokens[this.pos + 2]?.type === 'Ampersand')) {
            while (this.match('Newline') || this.match('Indent')) { }
            const operator = this.current.type;
            if (operator !== 'Pipe' && operator !== 'Ampersand')
                break;
            this.pos++;
            while (this.match('Newline') || this.match('Indent')) { }
            const right = optional(), kind = operator === 'Pipe' ? 'UnionType' : 'IntersectionType';
            left = left.kind === kind ? { ...left, types: [...left.types, right] } : { kind, types: [left, right] };
        }
        if (this.match('Identifier', 'is')) {
            const token = this.tokens[this.pos - 1];
            const target = this.type(true);
            if (left.kind !== 'NamedType' || target.kind !== 'NamedType')
                this.fail("'is' type operands must be type names");
            if (this.match('Question')) {
                const consequent = this.type();
                this.take('Colon', "Expected ':' in conditional type");
                return { kind: 'ConditionalType', check: left, target, consequent, alternate: this.type(), loc: this.loc(token) };
            }
            return { kind: 'ConditionalType', check: left, target, consequent: { kind: 'LiteralType', value: true }, alternate: { kind: 'LiteralType', value: false }, loc: this.loc(token) };
        }
        return left;
    }
    typeAtom() {
        let result;
        if (this.is('Identifier', 'typeof') && this.tokens[this.pos + 1]?.type === 'Less') {
            const token = this.take('Identifier');
            this.take('Less');
            const expression = this.expression(6);
            const typeQueryExpression = (value) => value.kind === 'Identifier' || value.kind === 'Member' && typeQueryExpression(value.object) || value.kind === 'Index' && typeQueryExpression(value.object) && (value.index.kind === 'Identifier' || value.index.kind === 'Literal');
            if (!typeQueryExpression(expression))
                this.fail('typeof<> only accepts an identifier, member, or indexed access');
            this.take('Greater', "Expected '>' after typeof expression");
            result = { kind: 'TypeOfType', expression, loc: this.loc(token) };
        }
        else if (this.match('Minus')) {
            const minus = this.tokens[this.pos - 1];
            const number = this.take('Number', 'Expected a number after \'-\' in literal type');
            result = { kind: 'LiteralType', value: -this.value(number), loc: this.loc(minus) };
        }
        else if (this.match('Number')) {
            const token = this.tokens[this.pos - 1];
            result = { kind: 'LiteralType', value: this.value(token), loc: this.loc(token) };
        }
        else if (this.match('String')) {
            const token = this.tokens[this.pos - 1];
            result = { kind: 'LiteralType', value: this.value(token), loc: this.loc(token) };
        }
        else if (this.match('Keyword', 'true') || this.match('Keyword', 'false')) {
            const token = this.tokens[this.pos - 1];
            result = { kind: 'LiteralType', value: this.value(token) === 'true', loc: this.loc(token) };
        }
        else if (this.match('LeftBrace')) {
            const members = [];
            this.objectSeparators();
            while (!this.is('RightBrace') && !this.is('EOF')) {
                if (this.match('LeftBracket')) {
                    const key = this.identifier();
                    this.take('Colon', "Expected ':' after index parameter");
                    const indexType = this.type();
                    this.take('RightBracket', "Expected ']' after index parameter type");
                    this.take('Colon', "Expected ':' before indexed value type");
                    const valueType = this.type();
                    members.push({ name: key.name, loc: key.loc, type: valueType, indexType, optional: false, readonly: false, constant: false });
                    this.objectSeparators();
                    continue;
                }
                let readonly = false, sealed = false, constant = false;
                while (this.is('Keyword') && ['readonly', 'sealed', 'const'].includes(String(this.value(this.current)))) {
                    const modifier = String(this.value(this.tokens[this.pos++]));
                    if (modifier === 'readonly')
                        readonly = true;
                    else if (modifier === 'sealed')
                        sealed = true;
                    else
                        constant = true;
                }
                const explicitFunction = this.match('Keyword', 'fun');
                const accessor = this.is('Identifier') && ['get', 'set'].includes(String(this.value(this.current))) && this.tokens[this.pos + 1]?.type === 'Identifier'
                    ? String(this.value(this.tokens[this.pos++]))
                    : undefined;
                const anonymousFunction = explicitFunction && this.is('LeftParen');
                const { name, loc } = anonymousFunction
                    ? { name: '', loc: this.loc(this.tokens[this.pos - 1]) }
                    : this.propertyName();
                const genericParameters = !anonymousFunction && this.match('Less') ? this.genericParameters() : [];
                let optional = this.match('Question');
                let params, method = false, type, body;
                if (this.is('LeftParen')) {
                    method = true;
                    params = this.parameters();
                    const returnType = this.match('Colon') ? this.type() : undefined;
                    if (this.match('Equal')) {
                        body = this.is('Newline') ? this.block() : [{ kind: 'Return', value: this.expression() }];
                        const last = body.at(-1);
                        if (anonymousFunction && last?.kind === 'ExpressionStatement') {
                            body[body.length - 1] = { kind: 'Return', value: last.expression };
                        }
                        type = returnType ?? { kind: 'NamedType', name: 'any' };
                    }
                    else
                        type = returnType ?? { kind: 'NamedType', name: 'void' };
                }
                else {
                    if (explicitFunction)
                        this.fail("Expected '(' after object function name");
                    if (this.match('Colon'))
                        type = this.type();
                    else if (this.is('Equal'))
                        type = { kind: 'NamedType', name: 'any' };
                    else
                        this.fail("Expected ':' or '=' after field name");
                }
                const defaultValue = this.match('Equal') ? this.expression() : undefined;
                if (constant && defaultValue === undefined)
                    this.fail('const type fields need a default value');
                if (!method && defaultValue && type.kind === 'NamedType' && type.name === 'any')
                    type = inferredTypeNode(defaultValue);
                if (accessor === 'get' && params?.length)
                    this.fail('A getter cannot have parameters');
                if (accessor === 'set' && params?.length !== 1)
                    this.fail('A setter must have exactly one parameter');
                const accessorType = accessor === 'set' ? params?.[0]?.type ?? { kind: 'NamedType', name: 'any' } : type;
                members.push({ name, loc, optional, readonly, sealed, constant, type: accessorType, defaultValue, method, accessor, generics: genericParameters.map(item => item.name), genericLocs: genericParameters.map(item => item.loc), genericConstraints: genericParameters.map(item => item.constraint), genericDefaults: genericParameters.map(item => item.defaultType), params, body });
                this.objectSeparators();
            }
            this.take('RightBrace');
            result = { kind: 'ObjectType', members };
        }
        else if (this.match('LeftParen')) {
            const args = [];
            if (!this.is('RightParen'))
                do {
                    args.push(this.type());
                } while (this.match('Comma'));
            this.take('RightParen');
            if (this.match('Arrow') || this.match('FatArrow'))
                result = { kind: 'FunctionType', params: args, result: this.type() };
            else if (args.length === 1)
                result = args[0];
            else
                this.fail('Expected function return type after -> or =>');
        }
        else if (this.match('LeftBracket')) {
            const elements = [];
            if (!this.is('RightBracket'))
                do {
                    elements.push(this.type());
                } while (this.match('Comma') && !this.is('RightBracket'));
            this.take('RightBracket', "Expected ']' after tuple type");
            result = { kind: 'GenericType', name: 'Tuple', args: elements };
        }
        else if (this.match('Keyword', 'null')) {
            result = { kind: 'NamedType', name: 'null', loc: this.loc(this.tokens[this.pos - 1]) };
        }
        else {
            const { name, loc } = this.identifier();
            let args = [];
            if (this.match('Less')) {
                args.push(this.type());
                while (this.match('Comma'))
                    args.push(this.type());
                this.take('Greater');
            }
            result = args.length ? { kind: 'GenericType', name, args, loc } : { kind: 'NamedType', name, loc };
        }
        while (this.match('LeftBracket')) {
            const bracket = this.tokens[this.pos - 1];
            if (this.match('RightBracket'))
                result = { kind: 'ArrayType', element: result };
            else {
                const index = this.type();
                this.take('RightBracket', "Expected ']' after indexed access type");
                result = { kind: 'IndexedAccessType', object: result, index, loc: this.loc(bracket) };
            }
        }
        return result;
    }
    expression(min = 0) {
        let left = this.prefix();
        let typeArguments;
        let continuationIndents = 0;
        const continuationLine = (requireDot) => {
            if (!this.is('Newline'))
                return false;
            const saved = this.pos;
            while (this.match('Newline')) { }
            const indented = this.match('Indent');
            if (requireDot && !this.is('Dot')) {
                this.pos = saved;
                return false;
            }
            if (indented)
                continuationIndents++;
            return true;
        };
        while (true) {
            // A member chain may continue on the next indented line either with
            // a leading dot or after a trailing dot on the previous line.
            if (continuationLine(true))
                continue;
            // Generic call type arguments are compile-time only: parse and discard them here.
            if (this.is('Less') && (left.kind === 'Identifier' || left.kind === 'Member')) {
                const saved = this.pos;
                try {
                    this.pos++;
                    typeArguments = [this.type()];
                    while (this.match('Comma'))
                        typeArguments.push(this.type());
                    this.take('Greater');
                    if (!this.is('LeftParen')) {
                        this.pos = saved;
                        typeArguments = undefined;
                    }
                }
                catch {
                    this.pos = saved;
                    typeArguments = undefined;
                }
                if (typeArguments)
                    continue;
            }
            if (this.match('Dot')) {
                continuationLine(false);
                const property = this.propertyName();
                left = { kind: 'Member', object: left, property: property.name, optional: false, loc: property.loc };
                continue;
            }
            if (this.is('Question') && this.tokens[this.pos + 1]?.type === 'Dot') {
                this.pos += 2;
                const property = this.propertyName();
                left = { kind: 'Member', object: left, property: property.name, optional: true, loc: property.loc };
                continue;
            }
            if (this.match('LeftBracket')) {
                const token = this.tokens[this.pos - 1];
                const index = this.expression();
                this.take('RightBracket', "Expected ']' after index");
                left = { kind: 'Index', object: left, index, loc: this.loc(token) };
                continue;
            }
            if (this.match('LeftParen')) {
                const args = [];
                this.parenthesisSeparators();
                if (!this.is('RightParen'))
                    do {
                        if (this.match('Ellipsis')) {
                            const token = this.tokens[this.pos - 1];
                            args.push({ kind: 'Spread', value: this.expression(), loc: this.loc(token) });
                        }
                        else
                            args.push(this.expression());
                        this.parenthesisSeparators();
                    } while (this.match('Comma') && (this.parenthesisSeparators(), true));
                this.take('RightParen');
                left = { kind: 'Call', callee: left, args, typeArguments };
                typeArguments = undefined;
                continue;
            }
            if (this.match('Bang')) {
                const token = this.tokens[this.pos - 1];
                left = { kind: 'Unary', operator: 'postfix!', operand: left, loc: this.loc(token) };
                continue;
            }
            if (this.match('Increment') || this.match('Decrement')) {
                const token = this.tokens[this.pos - 1];
                if (!['Identifier', 'Member', 'Index'].includes(left.kind))
                    this.fail('Increment and decrement require an assignable target');
                left = { kind: 'Unary', operator: token.type === 'Increment' ? 'postfix++' : 'postfix--', operand: left, loc: this.loc(token) };
                continue;
            }
            if (this.is('Question') && min <= 0) {
                const token = this.current;
                this.pos++;
                const consequent = this.expression();
                this.take('Colon', "Expected ':' in conditional expression");
                const alternate = this.expression();
                left = { kind: 'Conditional', condition: left, consequent, alternate, loc: this.loc(token) };
                continue;
            }
            if (this.softExpressionIndents > 0 && this.is('Newline')) {
                const saved = this.pos;
                while (this.match('Newline')) { }
                let consumed = 0;
                while (consumed < this.softExpressionIndents && this.match('Dedent'))
                    consumed++;
                if (consumed > 0) {
                    this.softExpressionIndents -= consumed;
                    break;
                }
                this.pos = saved;
            }
            if (continuationIndents > 0 && this.is('Newline')) {
                while (this.match('Newline')) { }
                while (continuationIndents > 0 && this.match('Dedent'))
                    continuationIndents--;
                if (continuationIndents === 0)
                    break;
            }
            const op = opTypes[this.current.type], p = op ? precedence[op] : undefined;
            if (!op || p === undefined || p < min)
                break;
            const operatorToken = this.current;
            this.pos++;
            left = { kind: 'Binary', operator: op, left, right: this.expression(p + 1), loc: this.loc(operatorToken) };
        }
        return left;
    }
    templateExpression(value, loc) {
        const parts = [];
        let cursor = 0;
        while (cursor < value.length) {
            const start = value.indexOf('${', cursor);
            if (start < 0) {
                parts.push(value.slice(cursor).replace(/\uE000/g, '$'));
                break;
            }
            if (start > cursor)
                parts.push(value.slice(cursor, start).replace(/\uE000/g, '$'));
            let depth = 1, quote = '', escaped = false, end = start + 2;
            for (; end < value.length; end++) {
                const char = value[end];
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (char === '\\') {
                    escaped = true;
                    continue;
                }
                if (quote) {
                    if (char === quote)
                        quote = '';
                    continue;
                }
                if (char === '"' || char === "'" || char === '`') {
                    quote = char;
                    continue;
                }
                if (char === '{')
                    depth++;
                else if (char === '}' && --depth === 0)
                    break;
            }
            if (depth !== 0)
                this.fail('Unterminated string interpolation');
            const rawSource = value.slice(start + 2, end);
            const leadingWhitespace = rawSource.length - rawSource.trimStart().length;
            const source = rawSource.trim();
            if (!source)
                this.fail('String interpolation cannot be empty');
            const expression = new Parser((0, lexer_1.Lexer)(source).tokenize()).parseExpressionOnly();
            const offset = start + 2 + leadingWhitespace;
            const shiftLoc = (loc) => {
                if (!loc)
                    return loc;
                const absoluteOffset = offset + loc.column - 1;
                const before = value.slice(0, absoluteOffset);
                const lastNewline = before.lastIndexOf('\n');
                return {
                    line: loc.line + (before.match(/\n/g)?.length ?? 0),
                    column: (lastNewline < 0 ? loc.column + offset : absoluteOffset - lastNewline) + (loc.line > 1 ? loc.column - 1 : 0)
                };
            };
            const shiftExpression = (node) => {
                if ('loc' in node)
                    node.loc = shiftLoc(node.loc);
                switch (node.kind) {
                    case 'Template':
                        for (const part of node.parts)
                            if (typeof part !== 'string')
                                shiftExpression(part);
                        break;
                    case 'RegEx': break;
                    case 'Array':
                        node.elements.forEach(shiftExpression);
                        break;
                    case 'Spread':
                        shiftExpression(node.value);
                        break;
                    case 'Object':
                        for (const property of node.properties) {
                            property.keyLoc = shiftLoc(property.keyLoc);
                            shiftExpression(property.value);
                        }
                        break;
                    case 'Unary':
                        shiftExpression(node.operand);
                        break;
                    case 'Assignment':
                        shiftExpression(node.value);
                        break;
                    case 'MemberAssignment':
                        node.propertyLoc = shiftLoc(node.propertyLoc);
                        shiftExpression(node.object);
                        if (node.index)
                            shiftExpression(node.index);
                        shiftExpression(node.value);
                        break;
                    case 'Binary':
                        shiftExpression(node.left);
                        shiftExpression(node.right);
                        break;
                    case 'Conditional':
                        shiftExpression(node.condition);
                        shiftExpression(node.consequent);
                        shiftExpression(node.alternate);
                        break;
                    case 'Match':
                        shiftExpression(node.value);
                        node.cases.forEach(item => { if (item.guard)
                            shiftExpression(item.guard); item.body.forEach(shiftStatement); });
                        break;
                    case 'Try':
                        if (node.value)
                            shiftExpression(node.value);
                        node.body?.forEach(shiftStatement);
                        node.catches.forEach(item => item.body.forEach(shiftStatement));
                        node.finallyBody?.forEach(shiftStatement);
                        break;
                    case 'Member':
                        shiftExpression(node.object);
                        break;
                    case 'Index':
                        shiftExpression(node.object);
                        shiftExpression(node.index);
                        break;
                    case 'Call':
                        shiftExpression(node.callee);
                        node.args.forEach(shiftExpression);
                        break;
                    case 'Function':
                        for (const param of node.params) {
                            param.loc = shiftLoc(param.loc);
                            if (param.defaultValue)
                                shiftExpression(param.defaultValue);
                        }
                        node.body.forEach(shiftStatement);
                        if (node.expressionBody)
                            shiftExpression(node.expressionBody);
                        break;
                }
            };
            const shiftStatement = (statement) => {
                if ('loc' in statement)
                    statement.loc = shiftLoc(statement.loc);
                switch (statement.kind) {
                    case 'Variable':
                        if (statement.initializer)
                            shiftExpression(statement.initializer);
                        break;
                    case 'ExpressionStatement':
                        shiftExpression(statement.expression);
                        break;
                    case 'Return':
                        if (statement.value)
                            shiftExpression(statement.value);
                        break;
                    case 'Break':
                        statement.loc = shiftLoc(statement.loc);
                        break;
                    case 'If':
                        shiftExpression(statement.condition);
                        statement.consequent.forEach(shiftStatement);
                        statement.alternate?.forEach(shiftStatement);
                        break;
                    case 'ForOf':
                        shiftExpression(statement.iterable);
                        statement.body.forEach(shiftStatement);
                        break;
                    case 'While':
                        shiftExpression(statement.condition);
                        statement.body.forEach(shiftStatement);
                        break;
                    case 'FunctionDeclaration':
                        statement.body.forEach(shiftStatement);
                        break;
                    case 'TypeDeclaration': break;
                    case 'Import': break;
                }
            };
            shiftExpression(expression);
            parts.push(expression);
            cursor = end + 1;
        }
        if (!parts.length)
            parts.push(value.replace(/\uE000/g, '$'));
        return { kind: 'Template', parts, loc };
    }
    prefix() {
        if (this.match('Keyword', 'try'))
            return this.tryExpression(this.tokens[this.pos - 1]);
        if (this.match('Keyword', 'match'))
            return this.matchExpression(this.tokens[this.pos - 1]);
        if (this.match('Keyword', 'await')) {
            const token = this.tokens[this.pos - 1];
            return { kind: 'Unary', operator: 'await', operand: this.expression(7), loc: this.loc(token) };
        }
        if (this.match('Increment') || this.match('Decrement')) {
            const token = this.tokens[this.pos - 1];
            const operand = this.expression(8);
            if (!['Identifier', 'Member', 'Index'].includes(operand.kind))
                this.fail('Increment and decrement require an assignable target');
            return { kind: 'Unary', operator: token.type === 'Increment' ? 'prefix++' : 'prefix--', operand, loc: this.loc(token) };
        }
        if (this.match('Minus') || this.match('Bang')) {
            const token = this.tokens[this.pos - 1];
            return { kind: 'Unary', operator: token.type === 'Minus' ? '-' : '!', operand: this.expression(7), loc: this.loc(token) };
        }
        if (this.match('BigInt')) {
            const token = this.tokens[this.pos - 1];
            return { kind: 'Literal', value: this.value(token), loc: this.loc(token) };
        }
        if (this.match('Number')) {
            const token = this.tokens[this.pos - 1];
            return { kind: 'Literal', value: this.value(token), loc: this.loc(token) };
        }
        if (this.match('String')) {
            const token = this.tokens[this.pos - 1];
            const value = this.value(token);
            return value.includes('${') ? this.templateExpression(value, this.loc(token)) : { kind: 'Literal', value: value.replace(/\uE000/g, '$'), loc: this.loc(token) };
        }
        if (this.match('RegEx')) {
            const token = this.tokens[this.pos - 1];
            return { kind: 'RegEx', source: token.value.source, flags: token.value.flags, loc: this.loc(token) };
        }
        if (this.match('Keyword', 'true'))
            return { kind: 'Literal', value: true, loc: this.loc(this.tokens[this.pos - 1]) };
        if (this.match('Keyword', 'false'))
            return { kind: 'Literal', value: false, loc: this.loc(this.tokens[this.pos - 1]) };
        if (this.match('Keyword', 'null'))
            return { kind: 'Literal', value: null, loc: this.loc(this.tokens[this.pos - 1]) };
        if (this.match('Identifier')) {
            const token = this.tokens[this.pos - 1];
            const name = String(this.value(token));
            const loc = this.loc(token);
            if (this.match('FatArrow')) {
                const params = [{ name, loc }];
                if (this.match('Newline')) {
                    this.take('Indent', 'Expected an indented function body');
                    const body = [];
                    this.separators();
                    while (!this.is('Dedent') && !this.is('EOF')) {
                        body.push(this.statement());
                        this.separators();
                    }
                    this.take('Dedent');
                    return { kind: 'Function', params, body };
                }
                return { kind: 'Function', params, body: [], expressionBody: this.expression() };
            }
            return { kind: 'Identifier', name, loc };
        }
        if (this.match('LeftParen')) {
            const openingParen = this.tokens[this.pos - 1];
            const saved = this.pos;
            let arrow = false;
            try {
                const params = [];
                if (!this.is('RightParen')) {
                    do {
                        const rest = this.is('Dot') && this.tokens[this.pos + 1]?.type === 'Dot' && this.tokens[this.pos + 2]?.type === 'Dot';
                        if (rest)
                            this.pos += 3;
                        const { name, loc } = this.identifier(), type = this.match('Colon') ? this.type() : undefined;
                        if (rest && (!type || (type.kind !== 'ArrayType' && !(type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray')))))
                            this.fail('A rest parameter must have an array type');
                        params.push({ name, loc, type, rest });
                    } while (this.match('Comma'));
                }
                this.take('RightParen');
                const hasReturnType = this.match('Colon');
                const returnType = hasReturnType ? this.type() : undefined;
                const newlineArrowBody = () => {
                    this.take('Indent', 'Expected an indented function body');
                    let depth = 0, expressionBody = false;
                    for (let index = this.pos; index < this.tokens.length; index++) {
                        const type = this.tokens[index].type;
                        if (type === 'LeftParen' || type === 'LeftBracket' || type === 'LeftBrace')
                            depth++;
                        else if (type === 'RightParen' || type === 'RightBracket' || type === 'RightBrace') {
                            if (depth === 0) {
                                expressionBody = true;
                                break;
                            }
                            depth--;
                        }
                        else if ((type === 'Dedent' || type === 'EOF') && depth === 0)
                            break;
                    }
                    if (expressionBody) {
                        this.softExpressionIndents++;
                        return { body: [], expressionBody: this.expression() };
                    }
                    const body = [];
                    this.separators();
                    while (!this.is('Dedent') && !this.is('EOF')) {
                        body.push(this.statement());
                        this.separators();
                    }
                    this.take('Dedent');
                    return { body };
                };
                if (hasReturnType && this.match('FatArrow')) {
                    arrow = true;
                    if (this.match('Newline')) {
                        return { kind: 'Function', loc: this.loc(openingParen), params, returnType, ...newlineArrowBody() };
                    }
                    return { kind: 'Function', loc: this.loc(openingParen), params, returnType, body: [], expressionBody: this.expression() };
                }
                if (this.match('FatArrow')) {
                    arrow = true;
                    if (this.match('Newline')) {
                        return { kind: 'Function', loc: this.loc(openingParen), params, returnType, ...newlineArrowBody() };
                    }
                    const expressionBody = this.expression();
                    return { kind: 'Function', loc: this.loc(openingParen), params, returnType, body: [], expressionBody };
                }
            }
            catch (error) {
                if (arrow)
                    throw error; /* Otherwise try parsing as a grouped expression. */
            }
            this.pos = saved;
            const value = this.expression();
            this.take('RightParen');
            return value;
        }
        if (this.match('LeftBracket')) {
            const token = this.tokens[this.pos - 1];
            const elements = [];
            this.parenthesisSeparators();
            while (!this.is('RightBracket') && !this.is('EOF')) {
                if (this.match('Ellipsis')) {
                    const spread = this.tokens[this.pos - 1];
                    elements.push({ kind: 'Spread', value: this.expression(), loc: this.loc(spread) });
                }
                else
                    elements.push(this.expression());
                this.parenthesisSeparators();
                if (this.match('Comma'))
                    this.parenthesisSeparators();
                else if (!this.is('RightBracket'))
                    this.fail("Expected ',' or ']' in array");
            }
            this.take('RightBracket');
            return { kind: 'Array', elements, loc: this.loc(token) };
        }
        if (this.match('LeftBrace')) {
            const token = this.tokens[this.pos - 1];
            const properties = [];
            this.objectSeparators();
            while (!this.is('RightBrace') && !this.is('EOF')) {
                if (this.match('LeftBracket')) {
                    const key = this.identifier();
                    this.take('Colon', "Expected ':' after index parameter");
                    const indexType = this.type();
                    this.take('RightBracket', "Expected ']' after index parameter type");
                    this.take('Colon', "Expected ':' before indexed value type");
                    const declaredType = this.type();
                    properties.push({ key: key.name, keyLoc: key.loc, value: { kind: 'Literal', value: null }, typeOnly: true, indexType, declaredType });
                    this.objectSeparators();
                    continue;
                }
                if (this.match('Ellipsis')) {
                    const value = this.expression();
                    properties.push({ key: '', keyLoc: 'loc' in value ? value.loc : undefined, value, spread: true });
                    this.objectSeparators();
                    if (this.match('Comma'))
                        this.objectSeparators();
                    continue;
                }
                let readonly = false, sealed = false;
                while (this.is('Keyword') && ['readonly', 'sealed'].includes(String(this.value(this.current)))) {
                    const modifier = String(this.value(this.tokens[this.pos++]));
                    if (modifier === 'readonly')
                        readonly = true;
                    else
                        sealed = true;
                }
                const explicitFunction = this.match('Keyword', 'fun');
                const accessor = this.is('Identifier') && ['get', 'set'].includes(String(this.value(this.current))) && this.tokens[this.pos + 1]?.type === 'Identifier'
                    ? String(this.value(this.tokens[this.pos++]))
                    : undefined;
                const anonymousFunction = explicitFunction && this.is('LeftParen');
                const property = anonymousFunction
                    ? { name: '', loc: this.loc(this.tokens[this.pos - 1]) }
                    : this.propertyName();
                const genericParameters = explicitFunction && !anonymousFunction && this.match('Less') ? this.genericParameters() : [];
                let value;
                if (accessor) {
                    const params = this.parameters();
                    const returnType = this.match('Colon') ? this.type() : undefined;
                    if (accessor === 'get' && params.length)
                        this.fail('A getter cannot have parameters');
                    if (accessor === 'set' && params.length !== 1)
                        this.fail('A setter must have exactly one parameter');
                    this.take('Equal', "Expected '=' before accessor body");
                    value = { kind: 'Function', params, returnType, body: this.block() };
                }
                else if (this.match('Colon'))
                    value = this.expression();
                else if (this.match('LeftParen')) {
                    this.pos--;
                    const params = this.parameters();
                    const returnType = this.match('Colon') ? this.type() : undefined;
                    this.take('Equal', "Expected '=' for method body");
                    const body = this.block();
                    const last = body.at(-1);
                    if (anonymousFunction && last?.kind === 'ExpressionStatement') {
                        body[body.length - 1] = { kind: 'Return', value: last.expression };
                    }
                    value = {
                        kind: 'Function',
                        generics: genericParameters.map(item => item.name),
                        genericLocs: genericParameters.map(item => item.loc),
                        genericConstraints: genericParameters.map(item => item.constraint),
                        genericDefaults: genericParameters.map(item => item.defaultType),
                        params, returnType, body
                    };
                }
                else if (explicitFunction)
                    this.fail("Expected '(' after object function name");
                else
                    value = { kind: 'Identifier', name: property.name, loc: property.loc };
                properties.push({ key: property.name, keyLoc: property.loc, value, accessor, readonly, sealed });
                this.objectSeparators();
                if (this.match('Comma'))
                    this.objectSeparators();
            }
            this.take('RightBrace');
            return { kind: 'Object', properties, loc: this.loc(token) };
        }
        if (this.match('Keyword', 'fun')) {
            const params = this.parameters(), returnType = this.match('Colon') ? this.type() : undefined;
            this.take('Equal');
            return { kind: 'Function', params, returnType, body: this.block() };
        }
        this.fail('Expected expression');
    }
    tryExpression(token) {
        let value, body;
        if (this.is('Newline'))
            body = this.block();
        else {
            value = this.expression();
            this.take('Newline', "Expected a newline after try expression");
        }
        while (this.match('Newline')) { }
        const indentedClauses = value !== undefined && this.match('Indent');
        const catches = [];
        let finallyBody;
        while (this.match('Keyword', 'catch')) {
            const catchToken = this.tokens[this.pos - 1];
            let binding, bindingLoc, type;
            if (this.match('LeftParen')) {
                const identifier = this.identifier();
                binding = identifier.name;
                bindingLoc = identifier.loc;
                if (this.match('Colon'))
                    type = this.type();
                this.take('RightParen', "Expected ')' after catch binding");
            }
            catches.push({ binding, bindingLoc, type, body: this.block(), loc: this.loc(catchToken) });
            while (this.match('Newline')) { }
        }
        if (this.match('Keyword', 'finally'))
            finallyBody = this.block();
        if (!catches.length)
            this.fail("A try expression needs at least one catch");
        if (indentedClauses)
            this.take('Dedent', "Expected the end of the try expression");
        return { kind: 'Try', value, body, catches, finallyBody, loc: this.loc(token) };
    }
}
exports.Parser = Parser;
const unknownType = { kind: 'unknown' };
function primitive(name) { return { kind: 'primitive', name }; }
function inferredTypeNode(expression) {
    switch (expression.kind) {
        case 'RegEx': return { kind: 'NamedType', name: 'RegEx' };
        case 'Literal': return { kind: 'NamedType', name: typeof expression.value === 'bigint' ? 'BigInt' : expression.value === null ? 'null' : typeof expression.value };
        case 'Template': return { kind: 'NamedType', name: 'string' };
        case 'Array': return { kind: 'ArrayType', element: expression.elements[0] ? inferredTypeNode(expression.elements[0]) : { kind: 'NamedType', name: 'any' } };
        case 'Spread': {
            const type = inferredTypeNode(expression.value);
            return type.kind === 'ArrayType' ? type.element : { kind: 'NamedType', name: 'any' };
        }
        case 'Object': return { kind: 'ObjectType', members: expression.properties.flatMap(property => property.accessor === 'set' ? [] : [{
                    name: property.key,
                    type: property.typeOnly ? property.declaredType ?? { kind: 'NamedType', name: 'any' } : property.accessor === 'get' && property.value.kind === 'Function' ? property.value.returnType ?? { kind: 'NamedType', name: 'any' } : inferredTypeNode(property.value),
                    optional: false,
                    readonly: Boolean(property.readonly),
                    sealed: Boolean(property.sealed),
                    constant: false,
                    indexType: property.indexType
                }]) };
        case 'Conditional': return inferredTypeNode(expression.consequent);
        case 'Is': return { kind: 'NamedType', name: 'boolean' };
        default: return { kind: 'NamedType', name: 'any' };
    }
}
function inferExpressionType(expression, variables) {
    switch (expression.kind) {
        case 'RegEx': return primitive('RegEx');
        case 'Literal':
            if (typeof expression.value === 'bigint')
                return primitive('BigInt');
            if (typeof expression.value === 'number' || typeof expression.value === 'string' || typeof expression.value === 'boolean')
                return { kind: 'literal', value: expression.value };
            return primitive('null');
        case 'Template':
            return primitive('string');
        case 'Identifier':
            return variables.get(expression.name) ?? unknownType;
        case 'Array': {
            if (expression.elements.length === 0)
                return { kind: 'array', element: unknownType };
            const elements = expression.elements.map(element => {
                if (element.kind !== 'Spread')
                    return inferExpressionType(element, variables);
                const spread = inferExpressionType(element.value, variables);
                return spread.kind === 'array' ? spread.element : unknownType;
            });
            return { kind: 'array', element: commonType(elements) };
        }
        case 'Spread': {
            const spread = inferExpressionType(expression.value, variables);
            return spread.kind === 'array' ? spread.element : unknownType;
        }
        case 'Object':
            return {
                kind: 'object',
                fields: new Map(expression.properties.filter(property => property.accessor !== 'set').map(property => [
                    property.key,
                    property.accessor === 'get' && property.value.kind === 'Function'
                        ? property.value.returnType ? typeFromNode(property.value.returnType) : inferFunctionReturnType(property.value.body, variables)
                        : inferExpressionType(property.value, variables)
                ]))
            };
        case 'Unary':
            if (expression.operator === '-' && expression.operand.kind === 'Literal' && typeof expression.operand.value === 'number')
                return { kind: 'literal', value: -expression.operand.value };
            return inferExpressionType(expression.operand, variables);
        case 'Conditional':
            return commonType([inferExpressionType(expression.consequent, variables), inferExpressionType(expression.alternate, variables)]);
        case 'Match': {
            const results = expression.cases.map(item => inferFunctionReturnType(item.body, new Map(variables)));
            if (!expression.cases.some(item => !item.pattern))
                results.push(primitive('null'));
            return commonType(results);
        }
        case 'Try': {
            const results = expression.catches.map(item => inferFunctionReturnType(item.body, new Map(variables)));
            return results.length ? commonType(results) : unknownType;
        }
        case 'Is': return primitive('boolean');
        case 'Member': {
            const object = inferExpressionType(expression.object, variables);
            return object.kind === 'object' ? object.fields.get(expression.property) ?? unknownType : unknownType;
        }
        case 'Index': {
            const object = inferExpressionType(expression.object, variables);
            const index = inferExpressionType(expression.index, variables);
            if (object.kind === 'array')
                return object.element;
            if (object.kind === 'object' && index.kind === 'primitive' && (index.name === 'string' || index.name === 'number')) {
                if (expression.index.kind === 'Literal')
                    return object.fields.get(String(expression.index.value)) ?? unknownType;
                return object.fields.size ? commonType([...object.fields.values()]) : unknownType;
            }
            return unknownType;
        }
        case 'Binary': {
            const left = inferExpressionType(expression.left, variables);
            const right = inferExpressionType(expression.right, variables);
            const operator = expression.operator;
            if (operator === '??')
                return left.kind === 'primitive' && left.name === 'null' ? right : left;
            if (operator === '&' || operator === '|')
                return primitive('boolean');
            if (left.kind !== 'primitive' || right.kind !== 'primitive')
                return unknownType;
            const leftName = left.name, rightName = right.name;
            if (operator === '+') {
                const allowed = (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'string' && rightName === 'string') ||
                    (leftName === 'BigInt' && rightName === 'BigInt');
                if (!allowed) {
                    throw new SyntaxError(`Invalid operands for '+': ${leftName} and ${rightName}. ` +
                        `Use number + number, string + string, or BigInt + BigInt.`);
                }
                return left;
            }
            if (operator === '*' || operator === '/') {
                const allowed = (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt');
                if (!allowed) {
                    throw new SyntaxError(`Invalid operands for '${operator}': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`);
                }
                return left;
            }
            if (operator === '-') {
                const allowed = (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt');
                if (!allowed) {
                    throw new SyntaxError(`Invalid operands for '-': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`);
                }
                return left;
            }
            if (operator === '<') {
                const allowed = (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt');
                if (!allowed) {
                    throw new SyntaxError(`Invalid operands for '<': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`);
                }
                return primitive('boolean');
            }
            if (operator === '>') {
                const allowed = (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt');
                if (!allowed) {
                    throw new SyntaxError(`Invalid operands for '>': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`);
                }
                return primitive('boolean');
            }
            if (operator === '<=') {
                const allowed = (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt');
                if (!allowed) {
                    throw new SyntaxError(`Invalid operands for '<=': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`);
                }
                return primitive('boolean');
            }
            if (operator === '>=') {
                const allowed = (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt');
                if (!allowed) {
                    throw new SyntaxError(`Invalid operands for '>=': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`);
                }
                return primitive('boolean');
            }
            return unknownType;
        }
        case 'Assignment':
            return unknownType;
        case 'MemberAssignment':
            return unknownType;
        case 'Function': {
            const scope = new Map(variables);
            for (const param of expression.params) {
                const declared = param.type ? typeFromNode(param.type) : undefined;
                const inferred = param.defaultValue ? inferExpressionType(param.defaultValue, scope) : unknownType;
                const parameterType = declared ?? (param.rest ? { kind: 'array', element: inferred } : inferred);
                scope.set(param.name, parameterType);
            }
            const result = expression.returnType
                ? typeFromNode(expression.returnType)
                : expression.expressionBody
                    ? inferExpressionType(expression.expressionBody, scope)
                    : inferFunctionReturnType(expression.body, scope);
            return { kind: 'function', params: expression.params.map(param => ({
                    type: param.type ? typeFromNode(param.type) : param.defaultValue ? inferExpressionType(param.defaultValue, scope) : unknownType,
                    optional: param.defaultValue !== undefined,
                    rest: param.rest === true
                })), result };
        }
        case 'Call': {
            const callee = inferExpressionType(expression.callee, variables);
            if (callee.kind !== 'function')
                return unknownType;
            if (callee.params) {
                const required = callee.params.filter(param => !param.optional && !param.rest).length;
                const rest = callee.params.some(param => param.rest);
                const maximum = rest ? Infinity : callee.params.length;
                const hasSpread = expression.args.some(argument => argument.kind === 'Spread');
                if (!hasSpread && (expression.args.length < required || expression.args.length > maximum)) {
                    throw new SyntaxError(`Expected ${required}${maximum === required ? '' : ` to ${maximum === Infinity ? 'any number of' : maximum}`} arguments, received ${expression.args.length}`);
                }
                expression.args.forEach((argument, index) => {
                    const parameter = callee.params.find((item, paramIndex) => item.rest ? index >= paramIndex : paramIndex === index);
                    if (!parameter)
                        return;
                    const actual = inferExpressionType(argument, variables);
                    if (!isAssignable(parameter.rest && parameter.type.kind === 'array' ? parameter.type.element : parameter.type, actual)) {
                        throw new SyntaxError(`Argument ${index + 1} has type ${describeType(actual)}; expected ${describeType(parameter.rest && parameter.type.kind === 'array' ? parameter.type.element : parameter.type)}`);
                    }
                });
            }
            return callee.result ?? primitive('null');
        }
    }
}
function commonType(types) {
    const first = types[0] ?? unknownType;
    if (types.every(type => sameType(first, type)))
        return first;
    return unknownType;
}
function inferFunctionReturnType(statements, variables) {
    const returns = [];
    const collect = (body, scope) => {
        for (const statement of body) {
            if (statement.kind === 'Return')
                returns.push(statement.value ? inferExpressionType(statement.value, scope) : primitive('null'));
            else if (statement.kind === 'If') {
                collect(statement.consequent, new Map(scope));
                if (statement.alternate)
                    collect(statement.alternate, new Map(scope));
            }
            else if (statement.kind === 'While' || statement.kind === 'ForOf') {
                collect(statement.body, new Map(scope));
            }
            else if (statement.kind === 'Variable' && statement.initializer) {
                scope.set(statement.name, statement.type ? typeFromNode(statement.type) : inferExpressionType(statement.initializer, scope));
            }
        }
    };
    collect(statements, new Map(variables));
    return commonType(returns.length ? returns : [primitive('null')]);
}
function sameType(a, b) {
    if (a.kind !== b.kind)
        return false;
    if (a.kind === 'primitive' && b.kind === 'primitive')
        return a.name === b.name;
    if (a.kind === 'literal' && b.kind === 'literal')
        return a.value === b.value;
    if (a.kind === 'array' && b.kind === 'array')
        return sameType(a.element, b.element);
    if (a.kind === 'object' && b.kind === 'object') {
        return a.fields.size === b.fields.size && [...a.fields].every(([key, value]) => b.fields.has(key) && sameType(value, b.fields.get(key)));
    }
    return a.kind === 'function' || a.kind === 'unknown';
}
function typeFromNode(type, aliases = new Map(), resolving = new Set()) {
    if (type.kind === 'LiteralType')
        return { kind: 'literal', value: type.value };
    if (type.kind === 'NamedType') {
        if (type.name === 'any' || type.name === 'unknown')
            return unknownType;
        const alias = aliases.get(type.name);
        if (alias && !resolving.has(type.name)) {
            const next = new Set(resolving);
            next.add(type.name);
            return typeFromNode(alias, aliases, next);
        }
        return ['string', 'number', 'boolean', 'BigInt', 'null', 'void', 'never', 'RegEx'].includes(type.name)
            ? primitive(type.name)
            : unknownType;
    }
    if (type.kind === 'ArrayType')
        return { kind: 'array', element: typeFromNode(type.element, aliases, resolving) };
    if (type.kind === 'TypeOfType')
        return unknownType;
    if (type.kind === 'IndexedAccessType') {
        const source = typeFromNode(type.object, aliases, resolving);
        const keys = type.index.kind === 'UnionType' ? type.index.types : [type.index];
        if (source.kind === 'array' && keys.every(key => key.kind === 'NamedType' && key.name === 'number' || key.kind === 'LiteralType' && typeof key.value === 'number'))
            return source.element;
        if (source.kind === 'object') {
            const selected = keys.flatMap(key => key.kind === 'LiteralType' && (typeof key.value === 'string' || typeof key.value === 'number') ? [source.fields.get(String(key.value))] : [])
                .filter((value) => Boolean(value));
            return selected.length === 1 ? selected[0] : selected.length ? { kind: 'union', types: selected } : unknownType;
        }
        return unknownType;
    }
    if (type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray')) {
        return { kind: 'array', element: type.args[0] ? typeFromNode(type.args[0], aliases, resolving) : unknownType };
    }
    if (type.kind === 'GenericType' && ['Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'KeyOf', 'Exclude'].includes(type.name) && type.args[0]) {
        if (type.name === 'Exclude') {
            const source = typeFromNode(type.args[0], aliases, resolving);
            const excluded = type.args[1] ? typeFromNode(type.args[1], aliases, resolving) : unknownType;
            const parts = source.kind === 'union' ? source.types : [source];
            const remaining = parts.filter(part => !isAssignable(excluded, part));
            return remaining.length === 1 ? remaining[0] : remaining.length ? { kind: 'union', types: remaining } : primitive('never');
        }
        const source = typeFromNode(type.args[0], aliases, resolving);
        if (type.name === 'KeyOf') {
            if (source.kind === 'array') {
                const names = ['length', 'indices', 'has', 'pick', 'omit', 'deepClone', 'deepFreeze', 'toDeepFreezed', 'at', 'concat', 'copy', 'copyWithin', 'entries', 'enumerate', 'every', 'fill', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flat', 'flatMap', 'forEach', 'includes', 'indexOf', 'iterator', 'join', 'lastIndexOf', 'map', 'pop', 'push', 'reduce', 'reduceRight', 'reverse', 'shift', 'slice', 'some', 'sort', 'splice', 'toArray', 'toReversed', 'toSorted', 'toSpliced', 'toString', 'unshift', 'with'];
                return { kind: 'union', types: [primitive('number'), ...names.map(value => ({ kind: 'literal', value }))] };
            }
            if (source.kind !== 'object')
                return unknownType;
            return { kind: 'union', types: [...source.fields.keys()].map(key => {
                    const numeric = Number(key);
                    return { kind: 'literal', value: key !== '' && Number.isFinite(numeric) && String(numeric) === key ? numeric : key };
                }) };
        }
        if (source.kind !== 'object')
            return unknownType;
        let fields = [...source.fields];
        if (type.name === 'Pick' || type.name === 'Omit') {
            const keyValues = (node) => {
                if (!node)
                    return [];
                if (node.kind === 'LiteralType' && typeof node.value === 'string')
                    return [node.value];
                if (node.kind === 'UnionType')
                    return node.types.flatMap(keyValues);
                if (node.kind === 'ArrayType')
                    return keyValues(node.element);
                return [];
            };
            const keys = new Set(keyValues(type.args[1]));
            fields = fields.filter(([key]) => type.name === 'Pick' ? keys.has(key) : !keys.has(key));
        }
        if (type.name === 'Partial')
            return { kind: 'object', fields: new Map() };
        return { kind: 'object', fields: new Map(fields) };
    }
    if (type.kind === 'ObjectType')
        return { kind: 'object', fields: new Map(type.members.filter(member => !member.indexType && (!member.method || member.accessor === 'get') && member.accessor !== 'set' && !member.optional && member.defaultValue === undefined && !(member.type.kind === 'UnionType' && member.type.types.some(part => part.kind === 'NamedType' && part.name === 'null'))).map(member => [member.name, typeFromNode(member.type, aliases, resolving)])) };
    if (type.kind === 'FunctionType')
        return { kind: 'function' };
    if (type.kind === 'UnionType')
        return { kind: 'union', types: type.types.map(part => typeFromNode(part, aliases, resolving)) };
    return unknownType;
}
function describeType(type) {
    if (type.kind === 'primitive')
        return type.name;
    if (type.kind === 'literal')
        return typeof type.value === 'string' ? JSON.stringify(type.value) : String(type.value);
    if (type.kind === 'union')
        return type.types.map(describeType).join(' | ');
    if (type.kind === 'array')
        return `${describeType(type.element)}[]`;
    if (type.kind === 'object')
        return `{ ${[...type.fields].map(([key, value]) => `${key}: ${describeType(value)}`).join(', ')} }`;
    return type.kind;
}
function isAssignable(expected, actual) {
    if (expected.kind === 'unknown' || actual.kind === 'unknown')
        return true;
    if (expected.kind === 'function' && actual.kind === 'object')
        return actual.fields.get('')?.kind === 'function';
    if (expected.kind === 'union')
        return actual.kind === 'union'
            ? actual.types.every(part => expected.types.some(option => isAssignable(option, part)))
            : expected.types.some(option => isAssignable(option, actual));
    if (actual.kind === 'union')
        return actual.types.every(part => isAssignable(expected, part));
    if (expected.kind === 'literal') {
        if (actual.kind === 'literal')
            return expected.value === actual.value;
        if (actual.kind === 'primitive')
            return actual.name === typeof expected.value;
        return false;
    }
    if (actual.kind === 'literal' && expected.kind === 'primitive')
        return expected.name === typeof actual.value;
    if (expected.kind !== actual.kind)
        return false;
    if (expected.kind === 'primitive' && actual.kind === 'primitive')
        return expected.name === actual.name;
    if (expected.kind === 'array' && actual.kind === 'array')
        return isAssignable(expected.element, actual.element);
    if (expected.kind === 'object' && actual.kind === 'object') {
        return [...expected.fields].every(([key, type]) => actual.fields.has(key) && isAssignable(type, actual.fields.get(key)));
    }
    return true;
}
function validateArithmeticTypes(statements, variables = new Map()) {
    const aliases = new Map();
    for (const statement of statements) {
        if (statement.kind === 'TypeDeclaration')
            aliases.set(statement.name, statement.value);
        if (statement.kind === 'Export' && statement.declaration.kind === 'TypeDeclaration')
            aliases.set(statement.declaration.name, statement.declaration.value);
        if (statement.kind === 'Import' && statement.importedTypes)
            for (const [name, value] of Object.entries(statement.importedTypes))
                aliases.set(name, value);
    }
    for (const statement of statements)
        if (statement.kind === 'Import' && !statement.importedTypes) {
            try {
                const { readFileSync } = require('node:fs');
                const { resolve, dirname } = require('node:path');
                if (statement.module.startsWith('.')) {
                    const base = resolve(process.cwd(), statement.module);
                    const file = /\.jn$/i.test(base) ? base : `${base}.jn`;
                    const imported = new Parser((0, lexer_1.Lexer)(readFileSync(file, 'utf8')).tokenize()).parse();
                    for (const item of imported)
                        if (item.kind === 'Export' && item.declaration.kind === 'TypeDeclaration')
                            aliases.set(item.declaration.name, item.declaration.value);
                }
                else if (statement.module === 'juno' && statement.namedImports.includes('Error')) {
                    aliases.set('Error', { kind: 'ObjectType', members: [
                            { name: 'name', type: { kind: 'NamedType', name: 'string' }, optional: false, readonly: false, constant: false },
                            { name: 'message', type: { kind: 'NamedType', name: 'string' }, optional: false, readonly: false, constant: false },
                            { name: 'stack', type: { kind: 'NamedType', name: 'string' }, optional: true, readonly: false, constant: false }
                        ] });
                }
            }
            catch { /* unresolved modules are reported by the interpreter */ }
        }
    for (const statement of statements) {
        switch (statement.kind) {
            case 'Variable': {
                const declaredType = statement.type ? typeFromNode(statement.type, aliases) : undefined;
                const inferredType = statement.initializer
                    ? inferExpressionType(statement.initializer, variables)
                    : undefined;
                const type = declaredType ?? inferredType;
                if (type)
                    variables.set(statement.name, type);
                if (statement.initializer) {
                    const actual = inferExpressionType(statement.initializer, variables);
                    if (declaredType && !isAssignable(declaredType, actual)) {
                        throw new SyntaxError(`Cannot assign ${describeType(actual)} to ${describeType(declaredType)} for '${statement.name}'`);
                    }
                }
                break;
            }
            case 'ExpressionStatement':
                inferExpressionType(statement.expression, variables);
                break;
            case 'Return':
                if (statement.value)
                    inferExpressionType(statement.value, variables);
                break;
            case 'If':
                inferExpressionType(statement.condition, variables);
                validateArithmeticTypes(statement.consequent, new Map(variables));
                if (statement.alternate) {
                    validateArithmeticTypes(statement.alternate, new Map(variables));
                }
                break;
            case 'While':
                inferExpressionType(statement.condition, variables);
                validateArithmeticTypes(statement.body, new Map(variables));
                break;
            case 'ForOf':
                inferExpressionType(statement.iterable, variables);
                validateArithmeticTypes(statement.body, new Map(variables));
                break;
            case 'FunctionDeclaration':
                {
                    const scope = new Map(variables);
                    const functionAliases = new Map(aliases);
                    for (const generic of statement.generics ?? [])
                        functionAliases.set(generic, { kind: 'NamedType', name: 'any' });
                    const params = statement.params.map(param => {
                        const declared = param.type ? typeFromNode(param.type, functionAliases) : undefined;
                        const inferred = param.defaultValue ? inferExpressionType(param.defaultValue, scope) : unknownType;
                        const type = declared ?? (param.rest ? { kind: 'array', element: inferred } : inferred);
                        scope.set(param.name, type);
                        return { type: param.rest && type.kind !== 'array' ? unknownType : type, optional: param.defaultValue !== undefined, rest: param.rest === true };
                    });
                    validateArithmeticTypes(statement.body, scope);
                    const result = statement.returnType
                        ? typeFromNode(statement.returnType, functionAliases)
                        : inferFunctionReturnType(statement.body, scope);
                    variables.set(statement.name, { kind: 'function', params, result });
                }
                break;
            case 'Import':
            case 'TypeDeclaration':
                break;
        }
    }
}
function parse(source, options = {}) {
    const statements = new Parser((0, lexer_1.Lexer)(source).tokenize()).parse();
    const types = new Map();
    const visit = (items, seen = new Set()) => {
        for (const item of items) {
            if (item.kind === 'Export' && item.declaration.kind === 'TypeDeclaration')
                types.set(item.declaration.name, item.declaration.value);
            if (item.kind === 'TypeDeclaration')
                types.set(item.name, item.value);
            if (item.kind === 'Import' && item.module.startsWith('.')) {
                try {
                    const fs = require('node:fs');
                    const path = require('node:path');
                    const base = path.resolve(options.filePath ? path.dirname(options.filePath) : process.cwd(), item.module);
                    const candidates = /\.jn$/i.test(base) ? [base] : [`${base}.jn`, path.resolve(base, 'index.jn')];
                    const file = candidates.find(candidate => fs.existsSync(candidate));
                    if (!file || seen.has(file))
                        continue;
                    const nested = visitParsed(file, seen);
                    for (const [name, value] of nested)
                        if (item.namedImports.includes(name))
                            types.set(name, value);
                }
                catch { /* module loading diagnostics are handled separately */ }
            }
            if (item.kind === 'Export' && item.declaration.kind === 'Import')
                visit([item.declaration], seen);
        }
    };
    const visitParsed = (file, seen) => {
        seen.add(file);
        const nested = new Map();
        const parsed = new Parser((0, lexer_1.Lexer)(require('node:fs').readFileSync(file, 'utf8')).tokenize()).parse();
        for (const item of parsed) {
            if (item.kind === 'Export' && item.declaration.kind === 'TypeDeclaration')
                nested.set(item.declaration.name, item.declaration.value);
            else if (item.kind === 'TypeDeclaration')
                nested.set(item.name, item.value);
            else if (item.kind === 'Export' && item.declaration.kind === 'Import' && item.declaration.importedTypes)
                for (const [name, value] of Object.entries(item.declaration.importedTypes))
                    nested.set(name, value);
        }
        return nested;
    };
    visit(statements);
    for (const item of statements)
        if (item.kind === 'Import' && item.module === 'juno' && item.namedImports.includes('Error'))
            types.set('Error', { kind: 'ObjectType', members: [
                    { name: 'name', type: { kind: 'NamedType', name: 'string' }, optional: false, readonly: false, constant: false },
                    { name: 'message', type: { kind: 'NamedType', name: 'string' }, optional: false, readonly: false, constant: false },
                    { name: 'stack', type: { kind: 'NamedType', name: 'string' }, optional: true, readonly: false, constant: false }
                ] });
    for (const item of statements)
        if (item.kind === 'Import') {
            item.importedTypes = Object.fromEntries([...types].filter(([name]) => item.namedImports.includes(name)));
        }
    if (options.validate !== false) {
        validateBreakStatements(statements);
        validateDeclarations(statements);
        validateArithmeticTypes(statements);
    }
    return statements;
}
function validateBreakStatements(statements, loopDepth = 0) {
    for (const statement of statements) {
        if (statement.kind === 'Break') {
            if (loopDepth === 0)
                throw new SyntaxError(`'break' is only valid inside a loop at ${statement.loc?.line ?? 1}:${statement.loc?.column ?? 1}`);
        }
        else if (statement.kind === 'While' || statement.kind === 'ForOf') {
            validateBreakStatements(statement.body, loopDepth + 1);
        }
        else if (statement.kind === 'If') {
            validateBreakStatements(statement.consequent, loopDepth);
            if (statement.alternate)
                validateBreakStatements(statement.alternate, loopDepth);
        }
        else if (statement.kind === 'FunctionDeclaration') {
            validateBreakStatements(statement.body, 0);
        }
        else if (statement.kind === 'ConstructorDeclaration') {
            for (const overload of statement.overloads)
                validateBreakStatements(overload.body, 0);
            for (const method of statement.methods)
                validateBreakStatements(method.body, 0);
        }
        else if (statement.kind === 'Export') {
            validateBreakStatements([statement.declaration], loopDepth);
        }
        else if (statement.kind === 'Variable' && statement.initializer) {
            validateBreakExpression(statement.initializer, loopDepth);
        }
        else if (statement.kind === 'Destructure' || statement.kind === 'ArrayDestructure') {
            validateBreakExpression(statement.initializer, loopDepth);
        }
        else if (statement.kind === 'ExpressionStatement') {
            validateBreakExpression(statement.expression, loopDepth);
        }
        else if (statement.kind === 'Return' && statement.value) {
            validateBreakExpression(statement.value, loopDepth);
        }
    }
}
function validateBreakExpression(expression, loopDepth) {
    if (expression.kind === 'Match') {
        validateBreakExpression(expression.value, loopDepth);
        for (const item of expression.cases) {
            if (item.guard)
                validateBreakExpression(item.guard, loopDepth);
            validateBreakStatements(item.body, loopDepth);
        }
    }
    else if (expression.kind === 'Function') {
        validateBreakStatements(expression.body, 0);
        if (expression.expressionBody)
            validateBreakExpression(expression.expressionBody, 0);
    }
    else if (expression.kind === 'Array')
        expression.elements.forEach(item => validateBreakExpression(item, loopDepth));
    else if (expression.kind === 'Object')
        expression.properties.forEach(item => validateBreakExpression(item.value, loopDepth));
    else if (expression.kind === 'Spread')
        validateBreakExpression(expression.value, loopDepth);
    else if (expression.kind === 'Template')
        expression.parts.forEach(item => { if (typeof item !== 'string')
            validateBreakExpression(item, loopDepth); });
    else if (expression.kind === 'Unary')
        validateBreakExpression(expression.operand, loopDepth);
    else if (expression.kind === 'Assignment')
        validateBreakExpression(expression.value, loopDepth);
    else if (expression.kind === 'MemberAssignment') {
        validateBreakExpression(expression.object, loopDepth);
        if (expression.index)
            validateBreakExpression(expression.index, loopDepth);
        validateBreakExpression(expression.value, loopDepth);
    }
    else if (expression.kind === 'Binary') {
        validateBreakExpression(expression.left, loopDepth);
        validateBreakExpression(expression.right, loopDepth);
    }
    else if (expression.kind === 'Conditional') {
        validateBreakExpression(expression.condition, loopDepth);
        validateBreakExpression(expression.consequent, loopDepth);
        validateBreakExpression(expression.alternate, loopDepth);
    }
    else if (expression.kind === 'Is')
        validateBreakExpression(expression.value, loopDepth);
    else if (expression.kind === 'Member')
        validateBreakExpression(expression.object, loopDepth);
    else if (expression.kind === 'Index') {
        validateBreakExpression(expression.object, loopDepth);
        validateBreakExpression(expression.index, loopDepth);
    }
    else if (expression.kind === 'Call') {
        validateBreakExpression(expression.callee, loopDepth);
        expression.args.forEach(item => validateBreakExpression(item, loopDepth));
    }
}
function validateDeclarations(statements, initialNames = new Set()) {
    const names = new Set(initialNames);
    for (const statement of statements) {
        const declarations = [];
        if (statement.kind === 'Import')
            declarations.push(...(statement.defaultImport ? [statement.defaultImport] : []), ...statement.namedImports);
        else if (statement.kind === 'Variable' || statement.kind === 'FunctionDeclaration' || statement.kind === 'TypeDeclaration')
            declarations.push(statement.name);
        else if (statement.kind === 'Destructure' || statement.kind === 'ArrayDestructure')
            declarations.push(...statement.bindings.flatMap(binding => binding.name && binding.name !== '_' ? [binding.name] : []));
        for (const name of declarations) {
            if (names.has(name))
                throw new SyntaxError(`Duplicate declaration '${name}' in the same scope`);
            names.add(name);
        }
        if (statement.kind === 'If') {
            validateDeclarations(statement.consequent);
            if (statement.alternate)
                validateDeclarations(statement.alternate);
        }
        else if (statement.kind === 'While' || statement.kind === 'ForOf')
            validateDeclarations(statement.body);
        else if (statement.kind === 'FunctionDeclaration') {
            const functionNames = new Set(statement.params.map(param => param.name));
            validateDeclarations(statement.body, functionNames);
        }
    }
}
