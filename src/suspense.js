import { Component, enqueueRender } from './component';
import { diff, commitRoot } from './diff/index';
import { removeNode, assign } from './util';
import { createElement } from './create-element';

// having a "custom class" here saves 50bytes gzipped
export function Suspense(props) {
	this._suspensions = [];
}
Suspense.prototype = new Component();

/**
 * @param {Promise} promise The thrown promise
 */
Suspense.prototype._childDidSuspend = function(promise, suspendingComponent) {
	if (!this._timeout) {
		if (typeof this.props.maxDuration === 'number') {
			this._timeoutCompleted = false;
			this._timeout = new Promise((res) => {
				setTimeout(() => {
					this._timeoutCompleted = true;
				}, this.props.maxDuration);
			});
		}
		else {
			this._timeoutCompleted = false;
			this._timeout = Promise.resolve({})
				.then(() => {
					this._timeoutCompleted = true;
				});
		}
	}

	this._suspensions.push(promise);
	let len = this._suspensions.length;

	const promiseCompleted = () => {
		// make sure we did not add any more suspensions
		if (len === this._suspensions.length) {
			// clear old suspensions
			this._suspensions = [];

			if (this._suspended) {
				this._suspended = false;
				
				// remove fallback dom
				if (this._fallbackDom) {
					removeNode(this._fallbackDom);
					this._fallbackDom = null;
				}

				// append parked dom
				if (this._parkedVnode._dom) {
					this._parentDom.appendChild(this._parkedVnode._dom);
				}
				this._parkedVnode = null;

				enqueueRender(suspendingComponent);
			}
		}
	};

	const timeoutOrPromiseCompleted = () => {
		if (this._timeoutCompleted && this._suspensions.length > 0 && !this._suspended) {
			this._suspended = true;
			
			// park old vnode & remove dom
			this._parkedVnode = this._prevVNode;
			if (this._parkedVnode._dom) {
				removeNode(this._parkedVnode._dom);
			}

			// render and mount fallback
			const mounts = [];
			const dom = this._fallbackDom = diff(this._vnode._dom, this.props.fallback, null, assign({}, this._context), false, null, [], this, null, null);
			if (dom!=null) {
				this._parentDom.appendChild(dom);
			}
			commitRoot(mounts, this._vnode);
		}
	};

	// _p is assigned here to let tests await this...
	this._p = Promise.race([
		this._timeout,
		// Suspense ignores errors thrown in Promises as this should be handled by user land code
		promise.then(promiseCompleted, promiseCompleted)
	])
		.then(timeoutOrPromiseCompleted);
};

Suspense.prototype.render = function(props, state) {
	return this._suspended ? props.fallback : props.children;
};

export function lazy(loader) {
	let prom;
	let component;
	let error;

	function Lazy(props) {
		if (!prom) {
			prom = loader();
			prom.then(
				(exports) => { component = exports.default; },
				(e) => { error = e; },
			);
		}

		if (error) {
			throw error;
		}

		if (!component) {
			throw prom;
		}

		return createElement(component, props);
	}

	Lazy.displayName = 'Lazy';

	return Lazy;
}
