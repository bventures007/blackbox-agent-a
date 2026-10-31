import {test} from 'node:test';
import assert from 'node:assert/strict';
import {minor} from '../packages/connectors/shopify.js';
import {observation} from '../packages/contracts/index.js';
test('money syntax preserves exact units, does not round or mix unknown currencies',()=>{assert.equal(minor('119.00','EUR'),11900);assert.equal(minor('1.005','KWD'),1005);assert.equal(minor('42','JPY'),42);assert.throws(()=>minor('1.001','EUR'));assert.throws(()=>minor('1.00','ZZZ'));assert.throws(()=>minor('999999999999999999','EUR'));});
test('canonical observations reject caller tenant and personal-content fields',()=>{assert.equal(observation.safeParse({tenant_id:'bad',email:'canary@example.test'}).success,false);});
