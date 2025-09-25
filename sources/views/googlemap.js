import base from "../views/view";
import DataLoader from "../core/dataloader";
import EventSystem from "../core/eventsystem";
import {protoUI} from "../ui/core";
import promise from "../thirdparty/promiz";
import {extend} from "../webix/helpers";

let google, script;

const api = {
	name:"google-map",
	$init:function(){
		this.$view.innerHTML = "<div class='webix_map_content' style='width:100%;height:100%'></div>";
		this._contentobj = this.$view.firstChild;
		this._waitMap = promise.defer();

		this.data.provideApi(this, true);
		this.$ready.push(this.render);
	},
	getMap:function(waitMap){
		return waitMap?this._waitMap:this._map;
	},
	_getCallBack:function(prev){
		return (()=>{
			if (typeof prev === "function") prev();

			google = google || window.google;
			this._initMap.call(this);
		});
	},
	render:function(){
		if(typeof window.google=="undefined"||typeof window.google.maps=="undefined"){
			if(!script){
				script = document.createElement("script");
				script.type = "text/javascript";

				const config = this._settings;
				let src = config.src || "//maps.google.com/maps/api/js";
				src += (src.indexOf("?")===-1 ? "?" :"&");

				if (config.key)
					src += "&key="+config.key;

				src += "&libraries="+config.libraries;

				script.src = src;
				document.getElementsByTagName("head")[0].appendChild(script);
			}
			script.onload = this._getCallBack(script.onload);
		}
		else //there's a custom link to google api in document head
			(this._getCallBack())();
	},
	_initMap:function(){
		const c = this.config;
		if(this.isVisible(c.id)){
			this._map = new google.maps.Map(this._contentobj, {
				zoom: c.zoom,
				center: new google.maps.LatLng(c.center[0], c.center[1]),
				mapTypeId: google.maps.MapTypeId[c.mapType],
				mapId: c.mapId
			});
			this._waitMap.resolve(this._map);
			this._contentobj.firstChild.setAttribute(/*@attr*/"webix_disable_drag", "true");
		}
	},
	center_setter:function(config){
		if(this._map)
			this._map.setCenter(new google.maps.LatLng(config[0], config[1]));

		return config;
	},
	mapType_setter:function(config){
		/*ROADMAP,SATELLITE,HYBRID,TERRAIN*/
		if(this._map)
			this._map.setMapTypeId(google.maps.MapTypeId[config]);

		return config;
	},
	zoom_setter:function(config){
		if(this._map)
			this._map.setZoom(config);
		return config;
	},
	layerType_setter:function(config){
		if(config == "heatmap")
			this.config.libraries = "visualization";
		else if(config == "marker")
			this.config.libraries = "marker";

		if(this._layerApi[config]){
			extend(this, this._layerApi[config], true);
			this.data.attachEvent("onStoreUpdated", (id, obj, mode)=> this._waitMap.then(()=> this.drawData.call(this, id, obj, mode)));
		}
		return config;
	},
	defaults:{
		zoom: 5,
		center:[ 39.5, -98.5 ],
		mapType: "ROADMAP",
		layerType:"marker"
	},
	$setSize:function(){
		base.api.$setSize.apply(this, arguments);
		if(this._map)
			google.maps.event.trigger(this._map, "resize");
	},
	$onLoad:function(data){
		if(!this._map){
			this._waitMap.then(()=> this.parse(data));
			return true;
		}
		return false;
	},
	_layerApi:{
		marker:{
			drawData:function(id, item, operation){
				switch (operation){
					case "add":
						item.$marker = this._getItemConfig(item);
						break;
					case "update":
						item.$marker = this._getItemConfig(item, true);
						break;
					case "delete":
						item.$marker.setMap(null);
						break;
					default:
						this.data.each(function(item){
							item.$marker = this._getItemConfig(item);
						}, this);
						break;
				}
			},
			clearAll:function(soft){
				this.data.each(function(obj){
					obj.$marker.setMap(null);
				});
				this.data.clearAll(soft);
			},
			showItem:function(id){
				const item = this.getItem(id);
				this._map.setCenter(new google.maps.LatLng(item.lat, item.lng));
			},
			_getItemConfig:function(item, update){
				const config = {
					position: { lat: item.lat, lng: item.lng },
					map: item.hidden ? null : this._map,
					title: item.title || "",
					gmpDraggable: item.draggable
				};

				let marker = item.$marker;
				if(!marker){
					if(this.config.template)
						config.content = this.config.template(item, google.maps.marker.PinElement);

					marker = item.$marker = new google.maps.marker.AdvancedMarkerElement(config);
					marker.id = item.id;

					this._events(marker);
				}
				else{
					if(update){
						extend(marker, config, true);
						if(this.config.template)
							marker.content = this.config.template(item, google.maps.marker.PinElement);
					}
					item.$marker.setMap(config.map);
				}

				this.callEvent("onItemRender", [item]);
				
				return marker;
			},
			_events:function(marker){
				const map = this;

				marker.addListener("click", function(){
					map.callEvent("onItemClick", [this.id, this]);
				});

				if(marker.gmpDraggable){
					marker.addListener("dragend", function(){ map._onDrag(this, true); });
					marker.addListener("drag", function(){ map._onDrag(this); });
				}
			},
			_onDrag:function(marker, end){
				const item = this.getItem(marker.id);
				const pos = marker.position;
				const ev = end ? "onAfterDrop" : "onDrag";

				item.lat = pos.lat;
				item.lng = pos.lng;

				this.callEvent(ev, [item.id, item]);
			}
		},
		heatmap:{
			heatmapConfig_setter:function(value){
				value = value || {};
				return value;
			},
			drawData:function(){
				if(this._heatmap){
					this._heatmap.setMap(null);
					this._heatmap = null;
				}

				const hdata = [];
				this.data.each(function(item){ hdata.push(this._getConfig(item)); }, this);

				if(hdata.length){
					const data = extend(this.config.heatmapConfig, {data:hdata, map:this._map}, true);
					this._heatmap = new google.maps.visualization.HeatmapLayer(data);
					this.callEvent("onHeatMapRender", [this._heatmap]);
				}
			},
			getHeatmap:function(){
				return this._heatmap;
			},
			_getConfig:function(item){
				const obj = {};
				for(const i in item) obj[i] = item[i];
				obj.location = new google.maps.LatLng(item.lat, item.lng);

				return obj;
			}
		}
	}
};

const view = protoUI(api,  DataLoader, EventSystem, base.view);
export default {api, view};