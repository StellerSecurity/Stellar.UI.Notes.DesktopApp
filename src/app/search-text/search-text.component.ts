import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { searchPresentation, SearchPart } from '../utils/search-presentation';
@Component({selector:'app-search-text',standalone:true,imports:[CommonModule],template:`<ng-container *ngFor="let part of parts"><mark *ngIf="part.match; else plain">{{part.text}}</mark><ng-template #plain>{{part.text}}</ng-template></ng-container>`,styles:[`:host{display:inline}mark{background:#fff0a6;color:#252016;border-radius:2px;padding:0 1px}`]})
export class SearchTextComponent implements OnChanges {
  @Input() text='';@Input() query='';@Input() snippet=false;
  parts:SearchPart[]=[];
  ngOnChanges():void {this.parts=searchPresentation(this.text,this.query,this.snippet);}
}
