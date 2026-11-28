const express = require('express')

// JunoScript object literals have an enumerable toString method.
function entries(record) {
    return Object.entries(record).filter(([key, value]) => key !== 'toString' || typeof value !== 'function')
}

module.exports = {
    createApp: express,
    listen(app, port, host) {
        return app.listen(port, host)
    },
    createRouter(app, prefix) {
        const router = express.Router()
        app.use(prefix, router)
        return router
    },
    configureBody(app, json, text) {
        if (json) app.use(express.json(json === true ? undefined : json))
        if (text) app.use(express.text(text === true ? undefined : text))
    },
    routeEntries(routes) {
        return entries(routes).flatMap(([path, endpoint]) => {
            if (!path.startsWith('/') || typeof endpoint === 'function' || Array.isArray(endpoint)
                || endpoint?.__junoFunction || Object.hasOwn(endpoint ?? {}, 'validateBody')) {
                return [[path, endpoint]]
            }
            return entries(endpoint).map(([method, handler]) => [`${method} ${path}`, handler])
        })
    },
    registerRoute(target, key, callback) {
        if (key.startsWith('/')) {
            target.all(key, callback)
            return
        }
        const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL)\s+(\/.*)$/i.exec(key)
        if (!match) throw new TypeError(`Invalid route: ${key}. Expected METHOD /path or /path.`)
        target.route(match[2])[match[1].toLowerCase()](callback)
    },
    sendResponse(response, reply) {
        reply.status(response.status ?? 200)
        if (response.headers) {
            for (const [name, value] of entries(response.headers)) reply.set(name, value)
        }
        if (response.body == null) return reply.end()
        if (typeof response.body === 'string') {
            if (!reply.get('Content-Type')) reply.type('text/plain')
            return reply.send(response.body)
        }
        return reply.json(response.body)
    },
    entries,
}
