package com.umbrella.kernel;

import org.apache.commons.pool2.impl.GenericObjectPoolConfig;

public class KernelConfig extends GenericObjectPoolConfig{
	private String url;
	private Libdir libdir;
	private int pageWidth;
	private int timeConstrained;
	private int timeConstrainedTotal;
	
	public String getUrl() {
		return url;
	}

	public void setUrl(String url) {
		this.url = url;
	}

	public Libdir getLibdir() {
		return libdir;
	}

	public void setLibdir(Libdir libdir) {
		this.libdir = libdir;
	}

	public int getPageWidth() {
		return pageWidth;
	}

	public void setPageWidth(int pageWidth) {
		this.pageWidth = pageWidth;
	}

	public int getTimeConstrained() {
		return timeConstrained;
	}

	public void setTimeConstrained(int timeConstrained) {
		this.timeConstrained = timeConstrained;
	}

	public int getTimeConstrainedTotal() {
		return timeConstrainedTotal;
	}

	public void setTimeConstrainedTotal(int timeConstrainedTotal) {
		this.timeConstrainedTotal = timeConstrainedTotal;
	}

	class Libdir {
		private String name;
		private String dir;
		public String getName() {
			return name;
		}
		public void setName(String name) {
			this.name = name;
		}
		public String getDir() {
			return dir;
		}
		public void setDir(String dir) {
			this.dir = dir;
		}
	}
}
